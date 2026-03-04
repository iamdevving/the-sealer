// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SealerID
 * @notice Soulbound identity NFT. One per wallet.
 *         tokenURI is dynamic — points to our permalink, always reflects latest.
 *         Renewal = new EAS attestation + updateTokenURI (same token ID, no burn).
 */
contract SealerID is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    // One SID per wallet
    mapping(address => uint256) public walletToTokenId;
    mapping(address => bool) public hasSID;

    // Identity metadata
    mapping(uint256 => string) public attestationTxHash;
    mapping(uint256 => uint256) public renewalCount;
    mapping(uint256 => address) public originalRecipient;

    event SealerIDMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        string attestationTxHash,
        string tokenURI
    );

    event SealerIDRenewed(
        uint256 indexed tokenId,
        address indexed recipient,
        string newAttestationTxHash,
        string newTokenURI,
        uint256 renewalCount
    );

    constructor(address initialOwner)
        ERC721("Sealer ID", "SID")
        Ownable(initialOwner)
    {}

    /**
     * @notice Mint a new Sealer ID. One per wallet enforced.
     * @param recipient      Wallet receiving the SID
     * @param uri            Dynamic permalink URI
     * @param _attestationTx EAS identity attestation TX hash
     */
    function mint(
        address recipient,
        string calldata uri,
        string calldata _attestationTx
    ) external onlyOwner returns (uint256) {
        require(!hasSID[recipient], "SealerID: wallet already has a Sealer ID");

        uint256 tokenId = _nextTokenId++;
        _safeMint(recipient, tokenId);
        _setTokenURI(tokenId, uri);

        walletToTokenId[recipient] = tokenId;
        hasSID[recipient] = true;
        attestationTxHash[tokenId] = _attestationTx;
        originalRecipient[tokenId] = recipient;

        emit SealerIDMinted(tokenId, recipient, _attestationTx, uri);
        return tokenId;
    }

    /**
     * @notice Renew a Sealer ID — update tokenURI and attestation in place.
     *         Same token ID persists. Old EAS attestation stays as history.
     * @param recipient         Wallet that owns the SID
     * @param newUri            New dynamic permalink URI
     * @param newAttestationTx  New EAS attestation TX hash
     */
    function renew(
        address recipient,
        string calldata newUri,
        string calldata newAttestationTx
    ) external onlyOwner {
        require(hasSID[recipient], "SealerID: wallet has no Sealer ID to renew");

        uint256 tokenId = walletToTokenId[recipient];
        _setTokenURI(tokenId, newUri);
        attestationTxHash[tokenId] = newAttestationTx;
        renewalCount[tokenId]++;

        emit SealerIDRenewed(tokenId, recipient, newAttestationTx, newUri, renewalCount[tokenId]);
    }

    /**
     * @notice Get token ID for a wallet. Reverts if no SID.
     */
    function getTokenId(address wallet) external view returns (uint256) {
        require(hasSID[wallet], "SealerID: wallet has no Sealer ID");
        return walletToTokenId[wallet];
    }

    // ── Soulbound: block all transfers after mint ──────────────────────
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            revert("SealerID: soulbound - non-transferable");
        }
        return super._update(to, tokenId, auth);
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }
}
