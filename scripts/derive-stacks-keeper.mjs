/**
 * Derive Leather/Xverse Stacks accounts from a 24-word secret key.
 * Reads the mnemonic from stdin — do not pass it as a CLI arg (shell history).
 *
 *   npx --yes -p @stacks/wallet-sdk -p @stacks/transactions \
 *     node scripts/derive-stacks-keeper.mjs
 *
 * Account 1 = m/44'/5757'/0'/0/0
 * Account 2 = m/44'/5757'/0'/0/1   ← keeper
 * Account 3 = m/44'/5757'/0'/0/2
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const { generateNewAccount, generateWallet } = await import("@stacks/wallet-sdk");
const { privateKeyToAddress } = await import("@stacks/transactions");

const rl = createInterface({ input: stdin, output: stdout });
const mnemonic = (await rl.question("Paste 24-word secret key (not stored): "))
  .trim()
  .replace(/\s+/g, " ");
rl.close();

if (mnemonic.split(" ").length !== 24) {
  console.error("Expected 24 words.");
  process.exit(1);
}

let wallet = await generateWallet({ secretKey: mnemonic, password: "" });
wallet = generateNewAccount(wallet);
wallet = generateNewAccount(wallet);

console.log("\nMatch these addresses to Leather/Xverse, then copy Account 2 into .env:\n");
for (let i = 0; i < 3; i++) {
  const account = wallet.accounts[i];
  const address = privateKeyToAddress(account.stxPrivateKey, "mainnet");
  const mark = i === 1 ? "  ← use this for STACKS KEEPER" : "";
  console.log(`Account ${i + 1}  m/44'/5757'/0'/0/${i}${mark}`);
  console.log(`  NEXT_PUBLIC_STACKS_KEEPER_ADDRESS=${address}`);
  console.log(`  STACKS_KEEPER_PRIVATE_KEY=${account.stxPrivateKey}`);
  console.log("");
}
