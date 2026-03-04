// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SealerStatement
 * @notice Soulbound NFT for Badge and Card credentials.
 *         Only the platform can mint. Non-transferable after mint.
 *         tokenURI points to IPFS metadata (permanent, static).
 */
contract SealerStatement is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    // productType: 0 = Badge, 1 = Card
    mapping(uint256 => uint8) public productType;
    mapping(uint256 => string) public attestationTxHash;
    mapping(uint256 => address) public originalRecipient;

    event StatementMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        uint8 productType,
        string attestationTxHash,
        string tokenURI
    );

    constructor(address initialOwner)
        ERC721("Sealer Statement", "STMT")
        Ownable(initialOwner)
    {}

    /**
     * @notice Mint a soulbound statement credential.
     * @param recipient     Wallet receiving the NFT
     * @param uri           IPFS or permalink URI for metadata
     * @param _productType  0 = Badge, 1 = Card
     * @param _attestationTx EAS attestation TX hash
     */
    function mint(
        address recipient,
        string calldata uri,
        uint8 _productType,
        string calldata _attestationTx
    ) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(recipient, tokenId);
        _setTokenURI(tokenId, uri);
        productType[tokenId] = _productType;
        attestationTxHash[tokenId] = _attestationTx;
        originalRecipient[tokenId] = recipient;

        emit StatementMinted(tokenId, recipient, _productType, _attestationTx, uri);
        return tokenId;
    }

    // ── Soulbound: block all transfers after mint ──────────────────────
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Allow minting (from == address(0)) but block transfers
        if (from != address(0)) {
            revert("SealerStatement: soulbound - non-transferable");
        }
        return super._update(to, tokenId, auth);
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }
}
