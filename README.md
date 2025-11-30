## FiAI On-Chain ChitChat

Upgradeable 1-1 messaging dapp built with Foundry and OpenZeppelin UUPS proxies. Each conversation between two EOAs shares a deterministic conversationId, and messages can be sent, edited, or soft-deleted while keeping history stable. A lightweight frontend (ethers v6 + plain JS) talks to the contract on Sepolia.

### Highlights
- UUPS-upgradeable `ChitChat` contract with owner-gated upgrade role.
- Conversation IDs are symmetric for any address pair; messages store sender, recipient, timestamp, content, and deletion flag.
- Soft delete keeps array indexes stable; edits restricted to original sender.
- Foundry test suite covers happy paths, reverts, and event emission through the proxy.
- Frontend connects via MetaMask, computes conversationId off-chain to mirror Solidity logic, and renders chat threads.

### Repo Layout
- `src/ChitChat.sol` – main upgradeable contract.
- `script/DeployChitChat.s.sol` – deploy proxy with initializer; `script/Upgrading.s.sol` for upgrades.
- `test/ChitChatTest.t.sol` – Foundry tests hitting the proxy.
- `frontend/` – static site (index.html, app.js, abi) targeting Sepolia.

## Getting Started

### Prerequisites
- Foundry (`forge` and `cast`) installed.
- A Sepolia RPC URL and funded deployer key if you plan to broadcast.
- Node is optional for the frontend (site is static; any HTTP server works).

### Install dependencies
```bash
forge install
```

## Run and Test

### Unit tests (Foundry)
```bash
forge test
```

### Deploy to Sepolia (UUPS proxy)
Set env vars for convenience:
```bash
export SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
export PRIVATE_KEY=0xabc...   # deployer key with funds
```
Run the deploy script (broadcast):
```bash
forge script script/DeployChitChat.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```
The script logs the proxy address; use that address in the frontend if different from the current default.

### Upgrade flow
```bash
forge script script/Upgrading.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```
Only accounts with `CAN_UPGRADE_ROLE` (granted by the owner) can authorize upgrades.

### Frontend (static)
- The app is configured for Sepolia and currently points to the contract at `0x79c175f4C66bcf294645f39B844501c3962D21c4` (update in `frontend/app.js` if you deploy a new proxy).
- Serve the `frontend` folder with any static server, e.g.:
```bash
python3 -m http.server 4173 --directory frontend
```
Then open `http://localhost:4173`. Connect MetaMask (Sepolia), enter a peer address, and start chatting.

## Notes
- Always interact via the proxy, not the implementation.
- The contract is non-payable and stores messages on-chain; content size directly affects gas.
