import type { EscrowParticipant } from "@atl/backend/src/chain";
import { TOKEN } from "./jobs";

/** Testnet convenience: gas check, mint mock tokens, stake for providers. */
export async function prepareWallets(w: { buyer: EscrowParticipant; honest: EscrowParticipant; faulty: EscrowParticipant }, log: (l: string) => void) {
  for (const [name, p] of [["BUYER", w.buyer], ["HONEST", w.honest], ["FAULTY", w.faulty]] as const) {
    if ((await p.ethBalance()) === 0n) throw new Error(`${name} wallet ${p.address} has no ETH for gas. Fund it from a faucet.`);
  }
  if ((await w.buyer.tokenBalance()) < 60n * TOKEN) {
    await w.buyer.mintMock(w.buyer.address, 100n * TOKEN);
    log("minted 100 mock tokens to the buyer");
  }
  for (const [name, p] of [["honest", w.honest], ["faulty", w.faulty]] as const) {
    if ((await p.freeStake()) < 10n * TOKEN) {
      if ((await p.tokenBalance()) < 30n * TOKEN) await p.mintMock(p.address, 50n * TOKEN);
      await p.stake(30n * TOKEN);
      log(`${name} provider staked 30 mock tokens`);
    }
  }
}
