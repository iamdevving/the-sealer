// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SealerSealed
 * @notice Transferable NFT for the SEALed product.
 *         The only tradeable credential in The Sealer ecosystem.
 *         tokenURI points to IPFS metadata (permanent, static).
 *         Original minter is recorded even after transfer.
 */
contract SealerSealed is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    mapping(uint256 => string) public attestationTxHash;
    mapping(uint256 => address) public originalMinter;
    mapping(uint256 => string) public paymentChain;

    event SealedMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        string attestationTxHash,
        string paymentChain,
        string tokenURI
    );

    constructor(address initialOwner)
        ERC721("Sealer Sealed", "SEALED")
        Ownable(initialOwner)
    {}

    /**
     * @notice Mint a SEALed NFT.
     * @param recipient      Wallet receiving the NFT
     * @param uri            IPFS or permalink URI for metadata
     * @param _attestationTx EAS attestation TX hash
     * @param _paymentChain  "Base" or "Solana"
     */
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

        emit SealedMinted(tokenId, recipient, _attestationTx, _paymentChain, uri);
        return tokenId;
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }
}
