import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createPublicClient, createTestClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

/** Chain tests need Foundry's anvil. Set ANVIL_BIN, or have `anvil` on PATH. Without it they are skipped. */
export const ANVIL_BIN = process.env.ANVIL_BIN ?? "anvil";
export const hasAnvil = spawnSync(ANVIL_BIN, ["--version"]).status === 0;

const MNEMONIC = "test test test test test test test test test test test junk";
export const acct = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });

export async function startAnvil(): Promise<{ url: string; stop: () => void; increaseTime: (s: number) => Promise<void> }> {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const url = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn(ANVIL_BIN, ["--port", String(port), "--silent"], { stdio: "ignore" });
  const client = createTestClient({ chain: foundry, mode: "anvil", transport: http(url) });
  const probe = createPublicClient({ chain: foundry, transport: http(url, { retryCount: 0 }) });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try {
      await probe.getChainId();
      ready = true;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!ready) {
    proc.kill();
    throw new Error("anvil did not become ready");
  }
  return {
    url,
    stop: () => void proc.kill(),
    increaseTime: async (s) => {
      await client.increaseTime({ seconds: s });
      await client.mine({ blocks: 1 });
    },
  };
}
