// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SealerSleeve
 * @notice Soulbound NFT for the Sleeve product.
 *         Wraps any image as a soulbound onchain keepsake.
 *         tokenURI points to metadata URI.
 *         Original minter is recorded permanently.
 */
contract SealerSleeve is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    mapping(uint256 => string) public attestationTxHash;
    mapping(uint256 => address) public originalMinter;
    mapping(uint256 => string) public paymentChain;

    event SleeveMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        string attestationTxHash,
        string paymentChain,
        string tokenURI
    );

    constructor(address initialOwner)
        ERC721("Sealer Sleeve", "SLEEVE")
        Ownable(initialOwner)
    {}

    function mint(
        address recipient,
        string calldata uri,
        string calldata _attestationTx,
        string calldata _paymentChain
    ) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(recipient, tokenId);
        _setTokenURI(tokenId, uri);

        attestationTxHash[tokenId] = _attestationTx;
        originalMinter[tokenId] = recipient;
        paymentChain[tokenId] = _paymentChain;

        emit SleeveMinted(tokenId, recipient, _attestationTx, _paymentChain, uri);
        return tokenId;
    }

    // ── Soulbound: block all transfers after mint ──────────────────────
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            revert("SealerSleeve: soulbound - non-transferable");
        }
        return super._update(to, tokenId, auth);
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }
}
