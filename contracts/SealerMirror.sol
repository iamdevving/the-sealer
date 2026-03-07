// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title SealerMirror
/// @notice Soulbound NFT that mirrors an NFT from any chain.
contract SealerMirror is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    address public operator;

    struct MirrorData {
        string  originalChain;
        string  originalContract;
        string  originalTokenId;
        address originalOwner;
        string  attestationTxHash;
        string  paymentChain;
        bool    invalidated;
    }

    struct MintParams {
        address recipient;
        string  tokenURI;
        string  originalChain;
        string  originalContract;
        string  originalTokenId;
        string  attestationTxHash;
        string  paymentChain;
    }

    mapping(uint256 => MirrorData) public mirrors;

    event MirrorMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        string originalChain,
        string originalContract,
        string originalTokenId,
        string attestationTxHash,
        string paymentChain
    );

    event MirrorInvalidated(
        uint256 indexed tokenId,
        address indexed originalOwner,
        string originalChain,
        string originalContract,
        string originalTokenId
    );

    event MirrorUpdated(
        uint256 indexed tokenId,
        string newOriginalChain,
        string newOriginalContract,
        string newOriginalTokenId,
        address newOriginalOwner
    );

    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner(), "Not operator");
        _;
    }

    constructor(address initialOwner) ERC721("Sealer Mirror", "MIRROR") Ownable(initialOwner) {
        operator = initialOwner;
    }

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
    }

    function mintMirror(MintParams calldata p) external onlyOperator returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(p.recipient, tokenId);
        _setTokenURI(tokenId, p.tokenURI);

        mirrors[tokenId] = MirrorData({
            originalChain:     p.originalChain,
            originalContract:  p.originalContract,
            originalTokenId:   p.originalTokenId,
            originalOwner:     p.recipient,
            attestationTxHash: p.attestationTxHash,
            paymentChain:      p.paymentChain,
            invalidated:       false
        });

        emit MirrorMinted(tokenId, p.recipient, p.originalChain, p.originalContract, p.originalTokenId, p.attestationTxHash, p.paymentChain);
        return tokenId;
    }

    function invalidate(uint256 tokenId) external onlyOperator {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        require(!mirrors[tokenId].invalidated, "Already invalidated");
        mirrors[tokenId].invalidated = true;
        emit MirrorInvalidated(
            tokenId,
            mirrors[tokenId].originalOwner,
            mirrors[tokenId].originalChain,
            mirrors[tokenId].originalContract,
            mirrors[tokenId].originalTokenId
        );
    }

    function updateMirror(
        uint256 tokenId,
        string calldata tokenURI_,
        string calldata newOriginalChain,
        string calldata newOriginalContract,
        string calldata newOriginalTokenId,
        address newOriginalOwner,
        string calldata newAttestationTxHash
    ) external onlyOperator {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        _setTokenURI(tokenId, tokenURI_);
        mirrors[tokenId].originalChain     = newOriginalChain;
        mirrors[tokenId].originalContract  = newOriginalContract;
        mirrors[tokenId].originalTokenId   = newOriginalTokenId;
        mirrors[tokenId].originalOwner     = newOriginalOwner;
        mirrors[tokenId].attestationTxHash = newAttestationTxHash;
        mirrors[tokenId].invalidated       = false;
        emit MirrorUpdated(tokenId, newOriginalChain, newOriginalContract, newOriginalTokenId, newOriginalOwner);
    }

    /// @notice Soulbound — block all transfers after mint
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            revert("Soulbound: transfers disabled");
        }
        return super._update(to, tokenId, auth);
    }
}
