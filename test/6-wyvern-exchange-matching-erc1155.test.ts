/* global artifacts:false, it:false, contract:false, assert:false */
import { expect, assert} from 'chai';
import { ethers } from 'hardhat';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';


import { 
  WyvernAtomicizer__factory,
  WyvernAtomicizer,
  WyvernExchange__factory,
  WyvernExchange,
  WyvernStatic__factory,
  WyvernStatic,
  WyvernRegistry__factory, 
  WyvernRegistry,
  TestERC20__factory,
  TestERC20,
  TestERC1155__factory,
  TestERC1155
} from '../build/types';

import { 
	wrap,
	sign,
	hashOrder,
	ZERO_BYTES32,
	CHAIN_ID,
	randomUint,
	NULL_SIG
  } from './auxiliary'
import { stat } from 'fs';


describe('WyvernExchange', () => {

	let signers;
	const decoder = new ethers.utils.AbiCoder();

	beforeEach(async () => {
		signers = await ethers.getSigners();
	})
	

	let deploy_core_contracts = async () =>
	{	
		signers = await ethers.getSigners();
		const wyvernRegistryFactory = new WyvernRegistry__factory(signers[0]);
		const wyvernAtomicizer = new WyvernAtomicizer__factory(signers[0]);
		const wyvernExchangeFactory = new WyvernExchange__factory(signers[0]);
		const wyvernStatic = new WyvernStatic__factory(signers[0]);
		let [registry,atomicizer] = await Promise.all([wyvernRegistryFactory.deploy(), wyvernAtomicizer.deploy()])
		let [exchange,statici] = await Promise.all([wyvernExchangeFactory.deploy(CHAIN_ID, [registry.address], '0x'), wyvernStatic.deploy(atomicizer.address)])
		await registry.grantInitialAuthentication(exchange.address)
		return {registry, exchange: wrap(exchange), atomicizer, statici}
	}

	it('matches erc1155 nft-nft swap order',async () =>
	{
		let account_a = signers[0]
		let account_b = signers[6]
		
		let {exchange, registry, statici} = await deploy_core_contracts();
		const erc1155Factory = (await ethers.getContractFactory('TestERC1155', signers[0])) as TestERC1155__factory;
		let erc1155 = await erc1155Factory.deploy();
		await erc1155.deployed();
		
		await registry.connect(account_a).registerProxy()
		let proxy1 = await registry.proxies(account_a.address)
		assert.equal(true, proxy1.length > 0, 'no proxy address for account a')

		await registry.connect(account_b).registerProxy()
		let proxy2 = await registry.proxies(account_b.address)
		assert.equal(true, proxy2.length > 0, 'no proxy address for account b')
		
		await Promise.all([erc1155.connect(account_a).setApprovalForAll(proxy1,true),erc1155.connect(account_b).setApprovalForAll(proxy2,true)])
		
		let nfts = [{tokenId:4,amount:1},{tokenId:5,amount:1}]
		await Promise.all([erc1155['mint(address,uint256,uint256)'](account_a.address, nfts[0].tokenId, 1),erc1155['mint(address,uint256,uint256)'](account_b.address,nfts[1].tokenId, 1)])
		
		let erc1155cFactory = new TestERC1155__factory(signers[0]);
		const erc1155c  = await erc1155cFactory.deploy();
		await erc1155c.deployed()
		const selector = statici.interface.getSighash('swapOneForOneERC1155(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
		
		const paramsOne = decoder.encode(
			['address[2]', 'uint256[2]', 'uint256[2]'],
			[[erc1155.address, erc1155.address], [nfts[0].tokenId, nfts[1].tokenId], [nfts[0].amount, nfts[1].amount]]
			)

		const paramsTwo = decoder.encode(
			['address[2]', 'uint256[2]', 'uint256[2]'],
			[[erc1155.address, erc1155.address], [nfts[1].tokenId, nfts[0].tokenId], [nfts[1].amount, nfts[0].amount]]
			)

		const one = {registry: registry.address, maker: account_a.address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsOne, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '7'}
		const two = {registry: registry.address, maker: account_b.address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsTwo, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '8'}

		const firstData = erc1155c.interface.encodeFunctionData('safeTransferFrom', [account_a.address, account_b.address, nfts[0].tokenId, nfts[0].amount, "0x"]) + ZERO_BYTES32.substr(2)
		const secondData = erc1155c.interface.encodeFunctionData('safeTransferFrom',[account_b.address, account_a.address, nfts[1].tokenId, nfts[1].amount, "0x"]) + ZERO_BYTES32.substr(2)
				
		const firstCall = {target: erc1155.address, howToCall: 0, data: firstData}
		const secondCall = {target: erc1155.address, howToCall: 0, data: secondData}
		const sigOne = NULL_SIG
		let sigTwo = await exchange.sign(two, account_b)

		await exchange.atomicMatch(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32)
		let [new_balance1,new_balance2] = await Promise.all([erc1155.balanceOf(account_a.address, nfts[1].tokenId),erc1155.balanceOf(account_b.address, nfts[0].tokenId)])
		assert.isTrue(new_balance1.toNumber() > 0,'Incorrect owner')
		assert.isTrue(new_balance2.toNumber() > 0,'Incorrect owner')
	})
		
	it('matches nft-nft swap order, abi-decoding instead',async () =>
	{
		let account_a = signers[0]
		let account_b = signers[6]
		
		let {exchange, registry, statici} = await deploy_core_contracts();
		const erc1155Factory = (await ethers.getContractFactory('TestERC1155', signers[0])) as TestERC1155__factory;
		let erc1155 = await erc1155Factory.deploy();
		await erc1155.deployed();
		
		await registry.connect(account_a).registerProxy()
		let proxy1 = await registry.proxies(account_a.address)
		assert.equal(true, proxy1.length > 0, 'no proxy address for account a')

		await registry.connect(account_b).registerProxy()
		let proxy2 = await registry.proxies(account_b.address)
		assert.equal(true, proxy2.length > 0, 'no proxy address for account b')
		
		await Promise.all([erc1155.connect(account_a).setApprovalForAll(proxy1,true),erc1155.connect(account_b).setApprovalForAll(proxy2,true)])
		
		let nfts = [{tokenId:4,amount:1},{tokenId:5,amount:1}]
		await Promise.all([erc1155['mint(address,uint256,uint256)'](account_a.address, nfts[0].tokenId, 1),erc1155['mint(address,uint256,uint256)'](account_b.address,nfts[1].tokenId, 1)])
		
		let erc1155cFactory = new TestERC1155__factory(signers[0]);
		const erc1155c  = await erc1155cFactory.deploy();
		await erc1155c.deployed()

		const selector = statici.interface.getSighash('swapOneForOneERC1155Decoding(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
		
		const paramsOne = decoder.encode(
			['address[2]', 'uint256[2]', 'uint256[2]'],
			[[erc1155.address, erc1155.address], [nfts[0].tokenId, nfts[1].tokenId], [nfts[0].amount, nfts[1].amount]]
			)

		const paramsTwo = decoder.encode(
			['address[2]', 'uint256[2]', 'uint256[2]'],
			[[erc1155.address, erc1155.address], [nfts[1].tokenId, nfts[0].tokenId], [nfts[1].amount, nfts[0].amount]]
			)
		
		const one = {registry: registry.address, maker: account_a.address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsOne, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '333123'}
		const two = {registry: registry.address, maker: account_b.address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsTwo, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '123344'}
		
		const firstData = erc1155c.interface.encodeFunctionData('safeTransferFrom', [account_a.address, account_b.address, nfts[0].tokenId, nfts[0].amount, "0x"]) + ZERO_BYTES32.substr(2)
		const secondData = erc1155c.interface.encodeFunctionData('safeTransferFrom',[account_b.address, account_a.address, nfts[1].tokenId, nfts[1].amount, "0x"]) + ZERO_BYTES32.substr(2)
		
		const firstCall = {target: erc1155.address, howToCall: 0, data: firstData}
		const secondCall = {target: erc1155.address, howToCall: 0, data: secondData}
		const sigOne = NULL_SIG
		
		let sigTwo = await exchange.sign(two, signers[6])
		await exchange.atomicMatch(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32)
		let [new_balance1,new_balance2] = await Promise.all([erc1155.balanceOf(account_a.address, nfts[1].tokenId),erc1155.balanceOf(account_b.address, nfts[0].tokenId)])
		assert.isTrue(new_balance1.toNumber() > 0,'Incorrect balance')
		assert.isTrue(new_balance2.toNumber() > 0,'Incorrect balance')
	})

	it('matches erc1155 + erc20 <> erc1155 orders, matched left, real static call',async () => 
	{
		let account_a = signers[0]
		let account_b = signers[6]
		
		let price = 10000
		let tokenId = 4

		let {atomicizer, exchange, registry, statici} = await deploy_core_contracts();
		const erc1155Factory = (await ethers.getContractFactory('TestERC1155', signers[0])) as TestERC1155__factory;
		let erc1155 = await erc1155Factory.deploy();
		await erc1155.deployed();
		const erc20Factory = (await ethers.getContractFactory('TestERC20', signers[0])) as TestERC20__factory;
		let erc20 = await erc20Factory.deploy();
		await erc20.deployed();
		
		await registry.connect(account_a).registerProxy()
		let proxy1 = await registry.proxies(account_a.address)
		assert.equal(true, proxy1.length > 0, 'no proxy address for account a')

		await registry.connect(account_b).registerProxy()
		let proxy2 = await registry.proxies(account_b.address)
		assert.equal(true, proxy2.length > 0, 'no proxy address for account b')
		
		await Promise.all([erc20.connect(account_a).approve(proxy1,price),erc1155.connect(account_a).setApprovalForAll(proxy1,true),erc1155.connect(account_b).setApprovalForAll(proxy2,true)])
		await Promise.all([erc20.mint(account_a.address,price),erc1155['mint(address,uint256,uint256)'](account_a.address,tokenId,1),erc1155['mint(address,uint256,uint256)'](account_b.address,tokenId,1)])
		
		const abi = [{'constant': false, 'inputs': [{'name': 'addrs', 'type': 'address[]'}, {'name': 'values', 'type': 'uint256[]'}, {'name': 'calldataLengths', 'type': 'uint256[]'}, {'name': 'calldatas', 'type': 'bytes'}], 'name': 'atomicize', 'outputs': [], 'payable': false, 'stateMutability': 'nonpayable', 'type': 'function'}]
		const wyvernAtomicizer = new WyvernAtomicizer__factory(signers[0])
		let atomicizerc = await wyvernAtomicizer.deploy();
		await atomicizerc.deployed()
   		let erc20c = await erc20Factory.deploy();
   		await erc20c.deployed()
		const erc1155c = await erc1155Factory.deploy()
		const selectorOne = statici.interface.getSighash('split(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
		const selectorOneA = statici.interface.getSighash('sequenceExact(bytes,address[7],uint8,uint256[6],bytes)')
		const selectorOneB = statici.interface.getSighash('sequenceExact(bytes,address[7],uint8,uint256[6],bytes)')
		const firstEDSelector = statici.interface.getSighash('transferERC20Exact(bytes,address[7],uint8,uint256[6],bytes)')
		const firstEDParams = decoder.encode(['address', 'uint256'], [erc20.address, price])
		const secondEDSelector = statici.interface.getSighash('transferERC1155Exact(bytes,address[7],uint8,uint256[6],bytes)')
		const secondEDParams = decoder.encode(['address', 'uint256', 'uint256'], [erc1155.address, tokenId, 1])
		const extradataOneA = decoder.encode(
		  ['address[]', 'uint256[]', 'bytes4[]', 'bytes'],
		  [[statici.address, statici.address],
			[(firstEDParams.length - 2) / 2, (secondEDParams.length - 2) / 2],
			[firstEDSelector, secondEDSelector],
			firstEDParams + secondEDParams.slice(2)]
		)
		const bEDParams = decoder.encode(['address', 'uint256', 'uint256'], [erc1155.address, tokenId, 1])
		const bEDSelector = statici.interface.getSighash('transferERC1155Exact(bytes,address[7],uint8,uint256[6],bytes)')
		const extradataOneB = decoder.encode(
		  ['address[]', 'uint256[]', 'bytes4[]', 'bytes'],
		  [[statici.address], [(bEDParams.length - 2) / 2], [bEDSelector], bEDParams]
		)
		const paramsOneA = decoder.encode(
		  ['address[2]', 'bytes4[2]', 'bytes', 'bytes'],
		  [[statici.address, statici.address],
			[selectorOneA, selectorOneB],
			extradataOneA, extradataOneB]
		)
		const extradataOne = paramsOneA
		const selectorTwo = statici.interface.getSighash('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
		const extradataTwo = '0x'
		const one = {registry: registry.address, maker: account_a.address, staticTarget: statici.address, staticSelector: selectorOne, staticExtradata: extradataOne, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '3352'}
		const two = {registry: registry.address, maker: account_b.address, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: extradataTwo, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '3335'}
		const sig = NULL_SIG
		const firstERC20Call = erc20c.interface.encodeFunctionData('transferFrom',[account_a.address, account_b.address, price])
		const firstERC1155Call = erc1155c.interface.encodeFunctionData('safeTransferFrom',[account_a.address, account_b.address, tokenId, 1, "0x"]) + ZERO_BYTES32.substr(2)
		const firstData = atomicizerc.interface.encodeFunctionData('atomicize',[
		  [erc20.address, erc1155.address],
		  [0, 0],
		  [(firstERC20Call.length - 2) / 2, (firstERC1155Call.length - 2) / 2],
		  firstERC20Call + firstERC1155Call.slice(2)
		])
		
		const secondERC1155Call = erc1155c.interface.encodeFunctionData('safeTransferFrom', [account_b.address, account_a.address, tokenId, 1, "0x"]) + ZERO_BYTES32.substr(2)
		const secondData = atomicizerc.interface.encodeFunctionData('atomicize', [
		  [erc1155.address],
		  [0],
		  [(secondERC1155Call.length - 2) / 2],
		  secondERC1155Call
		])
		
		const firstCall = {target: atomicizer.address, howToCall: 1, data: firstData}
		const secondCall = {target: atomicizer.address, howToCall: 1, data: secondData}
		
		let twoSig = await exchange.sign(two, account_b)
		assert.isOk(await exchange.atomicMatch(one, sig, firstCall, two, twoSig, secondCall, ZERO_BYTES32))
	})

	const erc1155_erc20_match_right_static_call = async (maximumFill,fillCount) => 
	{
		let account_a = signers[0]
		let account_b = signers[6]
		
		let price = 10000
		let tokenId = 4

		if (!maximumFill)
			maximumFill = 1
		
		if (!fillCount)
			fillCount = 1
		
		let {atomicizer, exchange, registry, statici} = await deploy_core_contracts();
		const erc1155Factory = (await ethers.getContractFactory('TestERC1155', signers[0])) as TestERC1155__factory;
		let erc1155 = await erc1155Factory.deploy();
		await erc1155.deployed();
		const erc20Factory = (await ethers.getContractFactory('TestERC20', signers[0])) as TestERC20__factory;
		let erc20 = await erc20Factory.deploy();
		await erc20.deployed();
	
		await registry.connect(account_a).registerProxy()
		let proxy1 = await registry.proxies(account_a.address)
		assert.equal(true, proxy1.length > 0, 'no proxy address for account a')

		await registry.connect(account_b).registerProxy()
		let proxy2 = await registry.proxies(account_b.address)
		assert.equal(true, proxy2.length > 0, 'no proxy address for account b')
		
		await Promise.all([erc20.connect(account_a).approve(proxy1,price*maximumFill),erc1155.connect(account_b).setApprovalForAll(proxy2,true)])
		await Promise.all([erc20.mint(account_a.address,price*maximumFill),erc1155['mint(address,uint256,uint256)'](account_b.address,tokenId,maximumFill)])
		
		const wyvernAtomicizer = new WyvernAtomicizer__factory(signers[0])
		let atomicizerc = await wyvernAtomicizer.deploy();
		await atomicizerc.deployed()
   		let erc20c = await erc20Factory.deploy();
   		await erc20c.deployed()
		const erc1155c = await erc1155Factory.deploy()
		const selectorOne = statici.interface.getSighash('splitAddOne(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
		const selectorOneA = statici.interface.getSighash('sequenceExact(bytes,address[7],uint8,uint256[6],bytes)')
		const selectorOneB = statici.interface.getSighash('sequenceExact(bytes,address[7],uint8,uint256[6],bytes)')
		const aEDParams = decoder.encode(['address', 'uint256'], [erc20.address, price])
		const aEDSelector = statici.interface.getSighash('transferERC20Exact(bytes,address[7],uint8,uint256[6],bytes)')
		
		// selectorOneA sequenceExact
		const extradataOneA = decoder.encode(
		['address[]', 'uint256[]', 'bytes4[]', 'bytes'],
		[[statici.address], [(aEDParams.length - 2) / 2], [aEDSelector], aEDParams]
		)
		
		const bEDParams = decoder.encode(['address', 'uint256', 'uint256'], [erc1155.address, tokenId, 1])
		const bEDSelector = statici.interface.getSighash('transferERC1155Exact(bytes,address[7],uint8,uint256[6],bytes)')
		
		// selectorOneB sequenceExact
		const extradataOneB = decoder.encode(
		['address[]', 'uint256[]', 'bytes4[]', 'bytes'],
		[[statici.address], [(bEDParams.length - 2) / 2], [bEDSelector], bEDParams]
		)
		
		// SelectorOne split
		const paramsOneA = decoder.encode(
		['address[2]', 'bytes4[2]', 'bytes', 'bytes'],
		[[statici.address, statici.address],
			[selectorOneA, selectorOneB],
			extradataOneA, extradataOneB]
		)

		const extradataOne = paramsOneA
		const selectorTwo = statici.interface.getSighash('anyAddOne(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
		const extradataTwo = '0x'
		const one = {registry: registry.address, maker: account_a.address, staticTarget: statici.address, staticSelector: selectorOne, staticExtradata: extradataOne, maximumFill: '2', listingTime: '0', expirationTime: '10000000000', salt: '3358'}
		const two = {registry: registry.address, maker: account_b.address, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: extradataTwo, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '3339'}
		//const twob = {registry: registry.address, maker: account_b, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: extradataTwo, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '3340'}
		const sig = await exchange.sign(one, account_a)
		const firstERC20Call = erc20c.interface.encodeFunctionData('transferFrom', [account_a.address, account_b.address, price])
		const firstData = atomicizerc.interface.encodeFunctionData('atomicize', [
			[erc20.address],
			[0],
			[(firstERC20Call.length - 2) / 2],
			firstERC20Call
		])
		
		const secondERC1155Call = erc1155c.interface.encodeFunctionData('safeTransferFrom', [account_b.address, account_a.address, tokenId, 1, "0x"]) + ZERO_BYTES32.substr(2)
		const secondData = atomicizerc.interface.encodeFunctionData('atomicize', [
			[erc1155.address],
			[0],
			[(secondERC1155Call.length - 2) / 2],
			secondERC1155Call
		])
		
		const firstCall = {target: atomicizer.address, howToCall: 1, data: firstData}
		const secondCall = {target: atomicizer.address, howToCall: 1, data: secondData}

		let twoSig = NULL_SIG
		
		for (let i = 0 ; i < fillCount ; ++i)
			assert.isOk(await exchange.atomicMatchWith(one, sig, firstCall, two, twoSig, secondCall, ZERO_BYTES32,{from:account_b}))
	}
		
	it('matches erc1155 <> erc20 signed orders, matched right, real static call',async () => 
		{
		return erc1155_erc20_match_right_static_call(1,1)
		})

	it('matches erc1155 <> erc20 signed orders, matched right, real static call, multiple fills',async () => 
		{
		return erc1155_erc20_match_right_static_call(2,2)
		})

	it('matches erc1155 <> erc20 signed orders, matched right, real static call, cannot fill beyond maximumFill',async () => 
	{
		return expect(
			erc1155_erc20_match_right_static_call(1,2)
		).to.be.revertedWith('First call failed')
	})
})
