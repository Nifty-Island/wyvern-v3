/*

  << TestERC1155 >>

*/

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract TestERC1155 is ERC1155("http://test/{id}.json") {

	/**
	 */
	constructor () public {
	}

	function mint(address to, uint256 tokenId) public returns (bool) {
		_mint(to, tokenId, 1, "");
		return true;
	}

	function mint(address to, uint256 tokenId, uint256 amount) public returns (bool) {
		_mint(to, tokenId, amount, "");
		return true;
	}

	function mintAndTransfer(address from, address to, uint256 tokenId, uint256 amount, string calldata uri, bytes calldata signature) public {
		bytes32 hash = ECDSA.toEthSignedMessageHash(keccak256(abi.encodePacked(tokenId, uri)));
		require(ECDSA.recover(hash, signature) == from, "Signature failed to recover");
		_mint(to, tokenId, amount, "");
	}
}
