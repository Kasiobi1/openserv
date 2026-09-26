// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentEscrow
/// @notice Escrow + provider stake for agent-to-agent jobs. Money only moves on `release` /
///         `refundAndSlash`, and only the policy signer can call those. Agents and models never hold that key.
/// @dev HACKATHON PROTOTYPE: unaudited, testnet only. Assumes a standard ERC-20 (no fee-on-transfer, no rebasing).
///      Known limitation: once a result is submitted, funds wait on the policy signer. There is no on-chain
///      timeout for that phase (a buyer-side timeout would let a buyer grief a provider after delivery).
contract AgentEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Funded, Submitted, Released, Slashed, Reclaimed }

    struct Job {
        address buyer;
        address provider;
        uint256 price;        // escrowed by the buyer
        uint256 stakeLocked;  // locked from the provider's free stake
        uint64 deadline;      // provider must submit by this time
        bytes32 resultHash;   // keccak256 of the canonical payload
        Status status;
    }

    uint256 public constant MAX_BPS = 10_000;

    IERC20 public immutable token;
    address public owner;
    address public policySigner;

    mapping(address => uint256) public freeStake;
    mapping(bytes32 => Job) private _jobs;

    event Staked(address indexed provider, uint256 amount);
    event StakeWithdrawn(address indexed provider, uint256 amount);
    event JobCreated(bytes32 indexed jobId, address indexed buyer, address indexed provider, uint256 price, uint256 stakeLocked, uint64 deadline);
    event ResultSubmitted(bytes32 indexed jobId, bytes32 resultHash);
    event Released(bytes32 indexed jobId, address indexed provider, uint256 price);
    event RefundedAndSlashed(bytes32 indexed jobId, address indexed buyer, uint256 refunded, uint256 slashed, uint256 stakeReturned);
    event Reclaimed(bytes32 indexed jobId, address indexed buyer, uint256 refunded);
    event PolicySignerUpdated(address indexed previous, address indexed next);
    event OwnerUpdated(address indexed previous, address indexed next);

    error NotPolicySigner();
    error NotOwner();
    error NotProvider();
    error NotBuyer();
    error BadStatus(Status actual);
    error JobExists();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientStake(uint256 have, uint256 need);
    error BadDeadline();
    error BadBps();
    error DeadlinePassed();
    error NotExpired();

    modifier onlyPolicySigner() {
        if (msg.sender != policySigner) revert NotPolicySigner();
        _;
    }

    constructor(IERC20 token_, address policySigner_, address owner_) {
        if (address(token_) == address(0) || policySigner_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        token = token_;
        policySigner = policySigner_;
        owner = owner_;
    }

    // ---------------------------------------------------------------- admin

    /// @notice Rotate the signer key. Owner only. Does not affect in-flight jobs' funds.
    function setPolicySigner(address next) external {
        if (msg.sender != owner) revert NotOwner();
        if (next == address(0)) revert ZeroAddress();
        emit PolicySignerUpdated(policySigner, next);
        policySigner = next;
    }

    function setOwner(address next) external {
        if (msg.sender != owner) revert NotOwner();
        if (next == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, next);
        owner = next;
    }

    // ---------------------------------------------------------------- provider stake

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        freeStake[msg.sender] += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /// @notice Withdraw stake that is not locked to a job.
    function withdrawStake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 have = freeStake[msg.sender];
        if (have < amount) revert InsufficientStake(have, amount);
        freeStake[msg.sender] = have - amount;
        token.safeTransfer(msg.sender, amount);
        emit StakeWithdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------- job lifecycle

    /// @notice Buyer funds a job and locks `stakeLocked` of the provider's free stake against it.
    function createJob(bytes32 jobId, address provider, uint256 price, uint256 stakeLocked, uint64 deadline)
        external
        nonReentrant
    {
        if (_jobs[jobId].status != Status.None) revert JobExists();
        if (provider == address(0)) revert ZeroAddress();
        if (price == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert BadDeadline();
        uint256 have = freeStake[provider];
        if (have < stakeLocked) revert InsufficientStake(have, stakeLocked);

        freeStake[provider] = have - stakeLocked;
        _jobs[jobId] = Job({
            buyer: msg.sender,
            provider: provider,
            price: price,
            stakeLocked: stakeLocked,
            deadline: deadline,
            resultHash: bytes32(0),
            status: Status.Funded
        });
        token.safeTransferFrom(msg.sender, address(this), price);
        emit JobCreated(jobId, msg.sender, provider, price, stakeLocked, deadline);
    }

    /// @notice Provider commits the hash of its off-chain payload.
    function submitResult(bytes32 jobId, bytes32 resultHash) external {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Funded) revert BadStatus(j.status);
        if (msg.sender != j.provider) revert NotProvider();
        if (block.timestamp > j.deadline) revert DeadlinePassed();
        j.resultHash = resultHash;
        j.status = Status.Submitted;
        emit ResultSubmitted(jobId, resultHash);
    }

    /// @notice Verified pass: pay the provider and unlock its stake. Policy signer only.
    function release(bytes32 jobId) external onlyPolicySigner nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Submitted) revert BadStatus(j.status);
        j.status = Status.Released;
        freeStake[j.provider] += j.stakeLocked;
        token.safeTransfer(j.provider, j.price);
        emit Released(jobId, j.provider, j.price);
    }

    /// @notice Verified fail: refund the buyer, slash `slashBps` of the locked stake to the buyer, return the rest.
    function refundAndSlash(bytes32 jobId, uint16 slashBps) external onlyPolicySigner nonReentrant {
        if (slashBps > MAX_BPS) revert BadBps();
        Job storage j = _jobs[jobId];
        if (j.status != Status.Submitted) revert BadStatus(j.status);
        j.status = Status.Slashed;

        uint256 slashed = (j.stakeLocked * slashBps) / MAX_BPS;
        uint256 returned = j.stakeLocked - slashed;
        freeStake[j.provider] += returned;
        token.safeTransfer(j.buyer, j.price + slashed);
        emit RefundedAndSlashed(jobId, j.buyer, j.price, slashed, returned);
    }

    /// @notice Provider never delivered by the deadline: buyer takes the price back, stake is unlocked unslashed.
    function reclaimExpired(bytes32 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Funded) revert BadStatus(j.status);
        if (msg.sender != j.buyer) revert NotBuyer();
        if (block.timestamp <= j.deadline) revert NotExpired();
        j.status = Status.Reclaimed;
        freeStake[j.provider] += j.stakeLocked;
        token.safeTransfer(j.buyer, j.price);
        emit Reclaimed(jobId, j.buyer, j.price);
    }

    // ---------------------------------------------------------------- views

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }
}
