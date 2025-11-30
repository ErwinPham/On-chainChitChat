// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    ReentrancyGuardUpgradeable
} from "lib/openzeppelin-contracts-upgradeable/contracts/utils/ReentrancyGuardUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/**
 * @title ChitChat - Upgradeable 1-1 On-chain Chat
 * @author Huy Pham (Luca Nero)
 * @notice This contract implements an upgradeable 1-1 chat system using OpenZeppelin’s UUPS proxy standard.
 *
 * @dev
 *  - The contract is upgradeable using the UUPS pattern (`UUPSUpgradeable`).
 *  - Initialization replaces the constructor to set up ownership.
 *  - Access control and ownership are managed through `OwnableUpgradeable`.
 *  - Each conversation is identified by a deterministic `conversationId` derived from a pair of addresses (order-independent).
 *  - Messages are stored on-chain in a per-conversation array, each containing sender, receiver, timestamp and content.
 *
 * Main Features:
 *  - 1-1 on-chain chat between any two EOA addresses.
 *  - Conversation ID is symmetric: (A, B) and (B, A) share the same conversation.
 *  - Basic CRUD operations on messages:
 *      - Create: send a new message.
 *      - Update: edit an existing message (only by the original sender).
 *      - Delete: soft-delete a message (flagged as deleted instead of being removed from storage).
 *  - Upgradeability via UUPS, restricted so that only the owner can authorize upgrades.
 *
 * Security Notes:
 *  - Always call `initialize()` after deploying the implementation behind a UUPS proxy.
 *  - Do not interact directly with the implementation contract in production – use the proxy instead.
 *  - The contract currently does not perform external calls or handle ETH, so reentrancy risk is minimal.
 *    However, the code is structured following the Check-Effects-Interactions pattern and can be easily
 *    extended with `ReentrancyGuardUpgradeable` if future versions introduce value transfers or external calls.
 */
contract ChitChat is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    AccessControlUpgradeable
{
    // ==========
    // = Errors =
    // ==========
    error InvalidAddress();
    error CannotChatWithSelf();
    error EmptyContent();
    error IndexOutOfBounds();
    error NotMessageSender();
    error MessageHasBeenDeleted();

    // ==========
    // = Events =
    // ==========
    event MessageSent(
        bytes32 indexed conversationId,
        address indexed from,
        address indexed to,
        uint256 index,
        string content,
        uint40 timestamp
    );
    event MessageEdited(bytes32 indexed conversationId, uint256 indexed index, string newContent);
    event MessageDeleted(bytes32 indexed conversationId, uint256 indexed index);

    // ===========
    // = Structs =
    // ===========
    struct Message {
        address from;
        address to;
        uint40 timestamp;
        bool isDeleted;
        string content;
    }

    // ===========
    // = Storage =
    // ===========
    // conversationId => list of messages
    mapping(bytes32 => Message[]) private _conversations;

    // =============
    // = Variables =
    // =============
    bytes32 public constant CAN_UPGRADE_ROLE = keccak256("CAN_UPGRADE_ROLE");

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                                        INITIALIZATION                                                      //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * @notice Initializes the upgradeable ChitChat contract.
     *
     * @dev
     * - Replaces the constructor in the upgradeable pattern.
     * - Sets the initial owner to the caller (`msg.sender`).
     * - Initializes reentrancy protection and UUPS upgrade mechanism.
     * - Grants `DEFAULT_ADMIN_ROLE` and `CAN_UPGRADE_ROLE` to the deployer.
     *
     * Requirements:
     * - MUST be called exactly once through the proxy.
     * - Subsequent calls will revert due to the `initializer` modifier.
     */
    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(CAN_UPGRADE_ROLE, _msgSender());
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                               PRIVATE AND INTERNAL FUNCTIONS                                               //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * @notice Computes a deterministic conversation identifier for two participants.
     *
     * @dev
     * - The conversation ID is symmetric: `_conversationId(A, B) == _conversationId(B, A)`.
     * - This is achieved by sorting the two addresses and hashing the ordered pair.
     *
     * @param user1 First participant address of the conversation.
     * @param user2 Second participant address of the conversation.
     *
     * @return conversationId A `bytes32` hash uniquely identifying the 1-1 conversation.
     *
     * Reverts:
     * - `InvalidAddress()` if either `user1` or `user2` is the zero address.
     * - `CannotChatWithSelf()` if `user1` and `user2` are the same address.
     */
    function _conversationId(address user1, address user2) internal pure returns (bytes32) {
        if (user1 == address(0) || user2 == address(0)) revert InvalidAddress();
        if (user1 == user2) revert CannotChatWithSelf();

        (address a, address b) = user1 < user2 ? (user1, user2) : (user2, user1);
        return keccak256(abi.encodePacked(a, b));
    }

    /**
     * @notice Internal helper to fetch a message by conversation ID and index.
     *
     * @dev
     * - Returns a storage reference to the message at the given index.
     * - This function is used by `editMessage` and `deleteMessage` to avoid code duplication.
     *
     * @param convId The computed conversation ID for two participants.
     * @param index  The zero-based index of the message in the conversation history.
     *
     * @return message A storage reference to the requested `Message`.
     *
     * Reverts:
     * - `IndexOutOfBounds()` if `index` is greater than or equal to the number of messages stored.
     */
    function _getMessage(bytes32 convId, uint256 index) internal view returns (Message storage) {
        Message[] storage msgs = _conversations[convId];
        if (index >= msgs.length) revert IndexOutOfBounds();
        return msgs[index];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                               PUBLIC AND EXTERNAL FUNCTIONS                                                //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * @notice Grants the `CAN_UPGRADE_ROLE` to a given account.
     *
     * @dev
     * - Only the contract owner (as defined by `OwnableUpgradeable`) can call this function.
     * - Accounts with `CAN_UPGRADE_ROLE` are allowed to authorize UUPS upgrades.
     *
     * @param _account The address to which the upgrade role will be granted.
     *
     * Requirements:
     * - Caller MUST be the owner.
     */
    function grantCanUpgradeRole(address _account) external onlyOwner {
        _grantRole(CAN_UPGRADE_ROLE, _account);
    }

    /**
     * @notice Sends a new on-chain message to another address within a 1-1 conversation.
     *
     * @dev
     * - Applies the Check-Effects-Interactions pattern for safety and clarity:
     *   1. **Check**: validate addresses and non-empty content.
     *   2. **Effects**: compute the conversation ID and push the message into storage.
     *   3. **Interactions**: emit the `MessageSent` event.
     * - Protected by `nonReentrant` to guard against future extensions that may introduce external calls.
     *
     * @param to      The recipient address of the message.
     * @param content The string content of the message to send.
     *
     * Emits:
     * - `MessageSent(conversationId, from, to, index, content, timestamp)` on success.
     *
     * Reverts:
     * - `InvalidAddress()` if `to` is the zero address.
     * - `CannotChatWithSelf()` if `to` equals `msg.sender`.
     * - `EmptyContent()` if `content` is an empty string.
     */
    function sendMessage(address to, string calldata content) external nonReentrant {
        //Check
        if (to == address(0)) revert InvalidAddress();
        if (msg.sender == to) revert CannotChatWithSelf();
        if (bytes(content).length == 0) revert EmptyContent();

        //Effects
        bytes32 convId = _conversationId(msg.sender, to);
        uint40 ts = uint40(block.timestamp);
        Message memory msgObj = Message({from: msg.sender, to: to, timestamp: ts, isDeleted: false, content: content});

        _conversations[convId].push(msgObj);
        uint256 index = _conversations[convId].length - 1;

        //Interactions
        emit MessageSent(convId, msg.sender, to, index, content, ts);
    }

    /**
     * @notice Edits an existing message in a conversation.
     *
     * @dev
     * - Only the original sender of the message is allowed to edit it.
     * - Messages that have been soft-deleted cannot be edited.
     * - Follows the Check-Effects-Interactions pattern:
     *   1. **Check**: validate new content, lookup message, verify sender and deletion status.
     *   2. **Effects**: update the `content` field of the message.
     *   3. **Interactions**: emit the `MessageEdited` event.
     *
     * @param user1      One participant of the conversation (order does not matter).
     * @param user2      The other participant of the conversation (order does not matter).
     * @param index      The zero-based index of the message to edit within the conversation.
     * @param newContent The new string content that will replace the old message content.
     *
     * Emits:
     * - `MessageEdited(conversationId, index, newContent)` on successful edit.
     *
     * Reverts:
     * - `EmptyContent()` if `newContent` is an empty string.
     * - `IndexOutOfBounds()` if `index` is invalid for the given conversation.
     * - `NotMessageSender()` if `msg.sender` is not the original `from` address of the message.
     * - `MessageHasBeenDeleted()` if the message was previously soft-deleted.
     */
    function editMessage(address user1, address user2, uint256 index, string calldata newContent)
        external
        nonReentrant
    {
        //Check
        if (bytes(newContent).length == 0) revert EmptyContent();

        bytes32 convId = _conversationId(user1, user2);
        Message storage m = _getMessage(convId, index);

        if (m.from != msg.sender) revert NotMessageSender();
        if (m.isDeleted) revert MessageHasBeenDeleted(); // không cho sửa tin đã xoá

        //Effects
        m.content = newContent;

        //Interactions
        emit MessageEdited(convId, index, newContent);
    }

    /**
     * @notice Soft-deletes an existing message in a conversation.
     *
     * @dev
     * - Only the original sender of the message can delete it.
     * - Deletion is soft: the message remains in storage but is flagged with `isDeleted = true`
     *   and its `content` is cleared, which helps preserve the conversation history and index stability.
     * - Follows the Check-Effects-Interactions pattern:
     *   1. **Check**: find the message, verify sender, ensure not already deleted.
     *   2. **Effects**: mark message as deleted and clear its content.
     *   3. **Interactions**: emit the `MessageDeleted` event.
     *
     * @param user1 One participant of the conversation (order does not matter).
     * @param user2 The other participant of the conversation (order does not matter).
     * @param index The zero-based index of the message to delete within the conversation.
     *
     * Emits:
     * - `MessageDeleted(conversationId, index)` on successful deletion.
     *
     * Reverts:
     * - `IndexOutOfBounds()` if `index` is invalid for the given conversation.
     * - `NotMessageSender()` if `msg.sender` is not the original `from` address of the message.
     * - `MessageHasBeenDeleted()` if the message was already deleted.
     */
    function deleteMessage(address user1, address user2, uint256 index) external nonReentrant {
        //Check
        bytes32 convId = _conversationId(user1, user2);
        Message storage m = _getMessage(convId, index);

        if (m.from != msg.sender) revert NotMessageSender();
        if (m.isDeleted) revert MessageHasBeenDeleted();

        //Effects
        m.isDeleted = true;
        m.content = "";

        //Interactions
        emit MessageDeleted(convId, index);
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                                      GETTER FUNCTIONS                                                      //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * @notice Returns the total number of messages in a conversation between two users.
     *
     * @dev
     * - The order of `user1` and `user2` does not matter.
     * - This function does not filter out deleted messages, it returns the raw length of the underlying array.
     *
     * @param user1 One participant of the conversation (order does not matter).
     * @param user2 The other participant of the conversation (order does not matter).
     *
     * @return length The total number of messages (including soft-deleted ones) in the conversation.
     */
    function getConversationLength(address user1, address user2) external view returns (uint256) {
        bytes32 convId = _conversationId(user1, user2);
        return _conversations[convId].length;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                                               UPGRADE                                                      //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * @notice Authorizes a UUPS upgrade to a new implementation contract.
     *
     * @dev
     * - This function is called internally by the UUPS proxy mechanism when `upgradeTo` or `upgradeToAndCall`
     *   is invoked via the proxy.
     * - Access is restricted by `onlyRole(CAN_UPGRADE_ROLE)`, so only accounts with the upgrade role
     *   can approve a new implementation address.
     *
     * @param newImplementation The address of the new implementation contract to which the proxy will be upgraded.
     *
     * Requirements:
     * - Caller MUST have `CAN_UPGRADE_ROLE`.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(CAN_UPGRADE_ROLE) {}

    // ==========
    //  Storage gap (để sau này thêm biến không phá layout)
    // ==========
    uint256[50] private __gap;
}

