# FiAI On-Chain ChitChat - Upgradeable 1-1 Messenger

[![Foundry](https://img.shields.io/badge/Built%20with-Foundry-FFDB1C.svg)](https://getfoundry.sh/)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.24-blue.svg)](https://soliditylang.org/)
[![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-Contracts-green.svg)](https://openzeppelin.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Author:** Huy Pham (Luca Nero)  
**Project Type:** Educational Capstone & Production-Ready Upgradeable Dapp

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Key Components](#key-components)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Quick Start](#quick-start)
  - [Detailed Workflow](#detailed-workflow)
- [Testing](#testing)
- [Deployed Contracts (Example)](#deployed-contracts-example)
- [Architecture Deep Dive](#architecture-deep-dive)
- [Development Workflow](#development-workflow)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [Educational Notes](#educational-notes)
- [License](#license)
- [Acknowledgments](#acknowledgments)
- [Resources & Further Reading](#resources--further-reading)

## Overview

FiAI On-Chain ChitChat is an upgradeable, on-chain 1-1 messaging dapp built on Ethereum using the **UUPS proxy pattern**. Two EOAs share a deterministic `conversationId`, enabling ordered message history that can be sent, edited, or soft-deleted without breaking indices. A lightweight frontend (ethers v6 + plain JS) connects via MetaMask and mirrors the Solidity hashing logic client-side.

### Purpose

- **Educational:** Demonstrates UUPS upgradeability, role-gated upgrades, and deterministic ID design for pairwise chats.
- **Production-Ready:** Ships with upgrade scripts, proxy-safe storage layout, revert/emit test coverage, and a Sepolia-ready frontend.

## Key Features

- 💬 **Deterministic Conversations:** Symmetric `conversationId` derived from sorted addresses (`keccak256(abi.encodePacked(a, b))`).
- ✍️ **Message Lifecycle:** Send, edit, and soft-delete messages while keeping array indices stable.
- 🛡️ **UUPS Upgradeability:** `_authorizeUpgrade` gated by `CAN_UPGRADE_ROLE`; owner can grant upgrade rights.
- 📡 **Event-Rich:** `MessageSent`, `MessageEdited`, `MessageDeleted` emitted for off-chain indexing/UIs.
- 🧪 **Proxy-First Tests:** Foundry tests target the deployed proxy to validate real upgradeable behavior.
- 🖥️ **Frontend Ready:** MetaMask connect, address normalization, off-chain conversationId computation, Sepolia config baked in.

## Architecture

The system uses a **UUPS Proxy Pattern** where:

- **Proxy Contract:** ERC1967 proxy delegates calls to the implementation.
- **Implementation Contract:** Stateless logic contract (`ChitChat` / `ChitChatV2`) holds business rules.
- **Storage:** Lives in the proxy; implementation can be swapped without migrating state.
- **Upgrades:** Authorized accounts call `upgradeTo/upgradeToAndCall` via UUPS.

```
┌────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
│   Frontend     │──▶│  UUPS Proxy      │──▶│  ChitChat Logic      │
│ (MetaMask +    │   │ (ERC1967)        │   │ (send/edit/delete)   │
│  ethers v6)    │   └──────────────────┘   └──────────────────────┘
└────────────────┘            │
                               ▼
                        ┌───────────────┐
                        │   Storage     │
                        │ conversation  │
                        │ arrays, roles │
                        └───────────────┘
```

## Key Components

### Smart Contracts (`src/`)

#### `ChitChat.sol` (V1)
- **Purpose:** Base upgradeable 1-1 chat with send/edit/delete.
- **Features:** Deterministic conversation IDs, soft deletes, owner + `CAN_UPGRADE_ROLE` gating, reentrancy guard scaffolding.

#### `ChitChatV2.sol` (V2)
- **Purpose:** Drop-in upgrade target for proxy; mirrors V1 API and keeps storage layout gap.
- **Use:** Serve as reference implementation for future iterations via UUPS upgrade script.

### Scripts (`script/`)

#### `DeployChitChat.s.sol`
- **Purpose:** Deploy implementation and proxy, calling `initialize()` once.
- **Config:** Uses `Upgrades.deployUUPSProxy("ChitChat.sol", abi.encodeCall(ChitChat.initialize, ()))`.

#### `Upgrading.s.sol`
- **Purpose:** Upgrade existing proxy to a new implementation (e.g., `ChitChatV2.sol`).
- **Config:** Hardcodes Sepolia proxy in `Deployed.ChitChat()` for convenience; uses storage layout validation.

### Frontend (`frontend/`)

- **`index.html` / `app.js` / `abi/ChitChat.json`:** Static site (no build step) using ethers v6. Handles MetaMask connect, peer selection, off-chain conversationId computation, message rendering, and transaction feedback. Default chain is **Sepolia**.

## Prerequisites

- **Foundry:** `forge`, `cast`, `anvil` installed.
- **RPC Endpoint:** Sepolia (Alchemy/Infura/etc.) for broadcasting.
- **Private Key:** Funded testnet key for deployment/upgrade (never commit).
- **Node (optional):** Only needed if you want a local static server; frontend works with any HTTP server.

## Installation

```bash
forge install
forge build
```

## Configuration

Create a `.env` (or export env vars) for scripts:

```bash
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
PRIVATE_KEY=0xabc... # testnet deployer with funds
```

Update the frontend contract address if you deploy a new proxy:
- `frontend/app.js` → `CONTRACT_ADDRESS`

## Usage

### Quick Start

```bash
# Compile
forge build

# Run tests
forge test
```

### Detailed Workflow

#### Step 1: Deploy Proxy (Sepolia or local)

```bash
forge script script/DeployChitChat.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

The script prints the proxy address. Keep it for upgrades and frontend config.

#### Step 2: Serve Frontend

```bash
python3 -m http.server 4173 --directory frontend
# open http://localhost:4173
```

Connect MetaMask (Sepolia), input a peer address, send/edit/delete messages. Conversation IDs are computed in-browser to match Solidity.

#### Step 3: Upgrade Flow (optional)

```bash
forge script script/Upgrading.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

Only addresses with `CAN_UPGRADE_ROLE` can authorize `_authorizeUpgrade`.

## Testing

### Running Tests

```bash
forge test
forge test -vvv          # verbose
forge coverage           # if installed
forge test --match-test testSendEditDeleteThroughProxy
```

### Test Descriptions (`test/ChitChatTest.t.sol`)

- **`testProxyInitializedCorrectly`**: Owner/admin/upgrade role set during proxy deploy.
- **`testSendEditDeleteThroughProxy`**: Full message lifecycle via proxy (send → edit → soft delete).
- **`testSendMessageRevertsViaProxy`**: Guards for empty content, self-chat, zero address.
- **Event tests**: `testMessageSentEventViaProxy`, `testMessageEditedEventViaProxy`, `testMessageDeletedEventViaProxy` ensure indexed/non-indexed fields emit correctly.

## Deployed Contracts (Example)

```
Network: Sepolia Testnet (Chain ID: 11155111)
Proxy (ChitChat): 0x79c175f4C66bcf294645f39B844501c3962D21c4
```

*Used by the frontend default config. Verify before interacting on-chain.*

## Architecture Deep Dive

### UUPS Upgrade Pattern

- `_authorizeUpgrade(address newImplementation)` requires `CAN_UPGRADE_ROLE` (owner grants).  
- `initialize()` replaces constructor; must be called once through the proxy.  
- Storage gap present to preserve layout for future versions.

### Conversation & Message Model

- `conversationId = keccak256(abi.encodePacked(sorted(user1, user2)))` (order independent).
- `Message` struct: `{from, to, timestamp(uint40), isDeleted, content}` stored per conversation array.
- Soft delete sets `isDeleted = true` and clears `content`, keeping indices stable for clients/indexers.

### Frontend Off-Chain Parity

- Uses `ethers.solidityPackedKeccak256(["address","address"], [a, b])` with sorted checksummed addresses to mirror Solidity hashing.
- Client enforces Sepolia chain ID and normalizes addresses with `ethers.getAddress`.

## Development Workflow

```bash
forge fmt          # format
forge fmt --check  # lint formatting
forge snapshot     # optional gas snapshots
```

## Troubleshooting

- **Proxy vs Implementation:** Always interact with the proxy address; calling implementation directly will bypass storage and fail.
- **MetaMask Chain Mismatch:** Frontend expects chain ID `11155111` (Sepolia).
- **Upgrade Validation Failure:** Ensure storage layout matches; keep `__gap` size intact when adding state.

## Security Considerations

- Role-based upgrades (`CAN_UPGRADE_ROLE`) prevent arbitrary logic changes.
- No ETH held; messages are plain strings—avoid sensitive data on-chain.
- Soft deletes keep content in history length but blank out text; emitted events already expose original content.
- Reentrancy guard scaffolded; follow Checks-Effects-Interactions for future external calls/value transfers.

## Project Structure

```
OnChainChitChat_FiAITest/
├── src/
│   ├── ChitChat.sol          # UUPS upgradeable V1
│   └── ChitChatV2.sol        # Upgrade target
├── script/
│   ├── DeployChitChat.s.sol  # Deploy proxy + initialize
│   └── Upgrading.s.sol       # Upgrade proxy to new impl
├── test/
│   └── ChitChatTest.t.sol    # Proxy-focused unit tests
├── frontend/
│   ├── index.html            # Static UI
│   ├── app.js                # ethers v6 logic + MetaMask
│   └── abi/ChitChat.json     # ABI for frontend
├── foundry.toml
└── broadcast/ | cache/ | out/
```

## Contributing

1. Fork and create a feature branch.
2. Add tests for new functionality (proxy-focused where applicable).
3. Keep storage layout compatible for upgrades; document changes in this README.
4. Submit PR with clear description and test results.

## Educational Notes

- Demonstrates UUPS upgrade flow end-to-end (deploy → use → upgrade).
- Shows deterministic ID design for pairwise interactions.
- Illustrates frontend parity with Solidity hashing to avoid ID mismatches.

## License

MIT License. See [`LICENSE`](LICENSE).

## Acknowledgments

- OpenZeppelin for upgradeable contracts and OZ Foundry upgrades plugin.
- Foundry team for `forge`/`cast` tooling.
- Ethereum community for best practices around UUPS proxies and event-driven UIs.

## Resources & Further Reading

- [OpenZeppelin UUPS Guide](https://docs.openzeppelin.com/contracts/4.x/api/proxy#UUPSUpgradeable)
- [Foundry Book](https://book.getfoundry.sh/)
- [Ethers v6 Docs](https://docs.ethers.org/v6/)
- [Smart Contract Security Best Practices](https://consensys.github.io/smart-contract-best-practices/)
