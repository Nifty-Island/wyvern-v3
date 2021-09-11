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
	StaticMarket__factory,
	StaticMarket,
	WyvernRegistry__factory, 
	WyvernRegistry,
	TestERC20__factory,
	TestERC20,
	TestERC721__factory,
	TestERC721,
	TestERC1155__factory,
	TestERC1155
} from '../build/types';

import {
	wrap,
	ZERO_BYTES32,
	CHAIN_ID,
} from './auxiliary'
import { decode } from 'querystring';

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
		const wyvernStatic = new StaticMarket__factory(signers[0]);
		let [registry,atomicizer] = await Promise.all([wyvernRegistryFactory.deploy(), wyvernAtomicizer.deploy()])
		let [exchange,statici] = await Promise.all([wyvernExchangeFactory.deploy(CHAIN_ID, [registry.address], '0x'), wyvernStatic.deploy()])
		await registry.grantInitialAuthentication(exchange.address)
		return {registry,exchange:wrap(exchange),atomicizer,statici}
	}

	const any_erc1155_for_erc20_test = async (options) =>
	{
		const {
			tokenId,
			buyTokenId,
			sellAmount,
			sellingPrice,
			sellingNumerator,
			buyingPrice,
			buyAmount,
			buyingDenominator,
			erc1155MintAmount,
			erc20MintAmount,
			account_a,
			account_b,
			sender,
			transactions
		} = options

		const txCount = transactions || 1
		
		let {exchange, registry, statici } = await deploy_core_contracts();
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
		
		await Promise.all([erc1155.connect(account_a).setApprovalForAll(proxy1,true),erc20.connect(account_b).approve(proxy2,erc20MintAmount)])
		await Promise.all([erc1155['mint(address,uint256,uint256)'](account_a.address,tokenId,erc1155MintAmount), erc20.mint(account_b.address,erc20MintAmount)])

		if (buyTokenId)
			await erc1155['mint(address,uint256,uint256)'](account_a.address,buyTokenId,erc1155MintAmount)

		const erc1155c = await erc1155Factory.deploy();
		const erc20c = await erc20Factory.deploy();
		const selectorOne = statici.interface.getSighash('anyERC1155ForERC20(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
		const selectorTwo = statici.interface.getSighash('anyERC20ForERC1155(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
			
		const paramsOne = decoder.encode(
			['address[2]', 'uint256[3]'],
			[[erc1155.address, erc20.address], [tokenId, sellingNumerator || 1, sellingPrice]]
			) 
	
		const paramsTwo = decoder.encode(
			['address[2]', 'uint256[3]'],
			[[erc20.address, erc1155.address], [buyTokenId || tokenId, buyingPrice, buyingDenominator || 1]]
			)

		const one = {registry: registry.address, maker: account_a.address, staticTarget: statici.address, staticSelector: selectorOne, staticExtradata: paramsOne, maximumFill: (sellingNumerator || 1) * sellAmount, listingTime: '0', expirationTime: '10000000000', salt: '11'}
		const two = {registry: registry.address, maker: account_b.address, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: paramsTwo, maximumFill: buyingPrice*buyAmount, listingTime: '0', expirationTime: '10000000000', salt: '12'}

		const firstData = erc1155c.interface.encodeFunctionData('safeTransferFrom', [account_a.address, account_b.address, tokenId, sellingNumerator || buyAmount, "0x"]) + ZERO_BYTES32.substr(2)
		const secondData = erc20c.interface.encodeFunctionData('transferFrom', [account_b.address, account_a.address, buyAmount*buyingPrice])
		
		const firstCall = {target: erc1155.address, howToCall: 0, data: firstData}
		const secondCall = {target: erc20.address, howToCall: 0, data: secondData}

		let sigOne = await exchange.sign(one, account_a)
		
		for (var i = 0 ; i < txCount ; ++i)
		{
			let sigTwo = await exchange.sign(two, account_b)
			assert.isOk(await exchange.atomicMatchWith(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: sender || account_a}))
			two.salt = two.salt + 1
		}
		
	}

	it('StaticMarket: matches erc1155 <> erc20 order, 1 fill',async () =>
		{
		const price = 10000

		return any_erc1155_for_erc20_test({
			tokenId: 5,
			sellAmount: 1,
			sellingPrice: price,
			buyingPrice: price,
			buyAmount: 1,
			erc1155MintAmount: 1,
			erc20MintAmount: price,
			account_a: signers[0],
			account_b: signers[6],
			sender: signers[1]
			})
		})

	it('StaticMarket: matches erc1155 <> erc20 order, multiple fills in 1 transaction',async () =>
		{
		const amount = 3
		const price = 10000

		return any_erc1155_for_erc20_test({
			tokenId: 5,
			sellAmount: amount,
			sellingPrice: price,
			buyingPrice: price,
			buyAmount: amount,
			erc1155MintAmount: amount,
			erc20MintAmount: amount*price,
			account_a: signers[0],
			account_b: signers[6],
			sender: signers[1]
			})
		})

	it('StaticMarket: matches erc1155 <> erc20 order, multiple fills in multiple transactions',async () =>
		{
		const nftAmount = 3
		const buyAmount = 1
		const price = 10000
		const transactions = 3

		return any_erc1155_for_erc20_test({
			tokenId: 5,
			sellAmount: nftAmount,
			sellingPrice: price,
			buyingPrice: price,
			buyAmount,
			erc1155MintAmount: nftAmount,
			erc20MintAmount: buyAmount*price*transactions,
			account_a: signers[0],
			account_b: signers[6],
			sender: signers[1],
			transactions
			})
		})

	it('StaticMarket: matches erc1155 <> erc20 order, allows any partial fill',async () =>
		{
		const nftAmount = 30
		const buyAmount = 4
		const price = 10000

		return any_erc1155_for_erc20_test({
			tokenId: 5,
			sellAmount: nftAmount,
			sellingPrice: price,
			buyingPrice: price,
			buyAmount,
			erc1155MintAmount: nftAmount,
			erc20MintAmount: buyAmount*price,
			account_a: signers[0],
			account_b: signers[6],
			sender: signers[1]
			})
		})

	it('StaticMarket: matches erc1155 <> erc20 order with any matching ratio',async () =>
	{
		const lot = 83974
		const price = 972

		return any_erc1155_for_erc20_test({
			tokenId: 5,
			sellAmount: 6,
			sellingNumerator: lot,
			sellingPrice: price,
			buyingPrice: price,
			buyingDenominator: lot,
			buyAmount: 1,
			erc1155MintAmount: lot,
			erc20MintAmount: price,
			account_a: signers[0],
			account_b: signers[6],
			sender: signers[1]
		})
	})

	it('StaticMarket: does not match erc1155 <> erc20 order beyond maximum fill',async () =>
		{
		const price = 10000

		return expect(
			any_erc1155_for_erc20_test({
				tokenId: 5,
				sellAmount: 1,
				sellingPrice: price,
				buyingPrice: price,
				buyAmount: 1,
				erc1155MintAmount: 2,
				erc20MintAmount: price*2,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1],
				transactions: 2
				})
		).to.be.revertedWith('First order has invalid parameters')
	})

	it('StaticMarket: does not fill erc1155 <> erc20 order with different prices',async () =>
		{
		const price = 10000

		return expect(
			any_erc1155_for_erc20_test({
				tokenId: 5,
				sellAmount: 1,
				sellingPrice: price,
				buyingPrice: price-10,
				buyAmount: 1,
				erc1155MintAmount: 1,
				erc20MintAmount: price,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1]
				})
		).to.be.revertedWith('Static call failed')
	})

	it('StaticMarket: does not fill erc1155 <> erc20 order with different ratios',async () =>
	{
		const price = 10000

		return expect(
			any_erc1155_for_erc20_test({
				tokenId: 5,
				sellAmount: 1,
				sellingPrice: price,
				buyingPrice: price,
				buyingDenominator: 2,
				buyAmount: 1,
				erc1155MintAmount: 1,
				erc20MintAmount: price,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1]
				})
		).to.be.revertedWith('Static call failed')
	})

	it('StaticMarket: does not fill erc1155 <> erc20 order beyond maximum sell amount',async () =>
		{
		const nftAmount = 2
		const buyAmount = 3
		const price = 10000

		return expect(
			any_erc1155_for_erc20_test({
				tokenId: 5,
				sellAmount: nftAmount,
				sellingPrice: price,
				buyingPrice: price,
				buyAmount,
				erc1155MintAmount: nftAmount,
				erc20MintAmount: buyAmount*price,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1]
			})
		).to.be.revertedWith('First call failed')
	})

	it('StaticMarket: does not fill erc1155 <> erc20 order if balance is insufficient',async () =>
		{
		const nftAmount = 1
		const buyAmount = 1
		const price = 10000

		return expect(
			any_erc1155_for_erc20_test({
				tokenId: 5,
				sellAmount: nftAmount,
				sellingPrice: price,
				buyingPrice: price,
				buyAmount,
				erc1155MintAmount: nftAmount,
				erc20MintAmount: buyAmount*price-1,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1]
				})
		).to.be.revertedWith('Second call failed')
	})

	it('StaticMarket: does not fill erc1155 <> erc20 order if the token IDs are different',async () =>
		{
		const price = 10000

		return expect(
			any_erc1155_for_erc20_test({
				tokenId: 5,
				buyTokenId: 6,
				sellAmount: 1,
				sellingPrice: price,
				buyingPrice: price,
				buyAmount: 1,
				erc1155MintAmount: 1,
				erc20MintAmount: price,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1],
			})
		).to.be.revertedWith('Static call failed')
	})

	const any_erc20_for_erc20_test = async (options) =>
		{
		const {sellAmount,
			sellingPrice,
			buyingPrice,
			buyPriceOffset,
			buyAmount,
			erc20MintAmountSeller,
			erc20MintAmountBuyer,
			account_a,
			account_b,
			sender,
			transactions} = options

		const txCount = transactions || 1
		const takerPriceOffset = buyPriceOffset || 0
		
		let {exchange, registry, statici} = await deploy_core_contracts()
		const erc20Factory = (await ethers.getContractFactory('TestERC20', signers[0])) as TestERC20__factory;
		let [erc20Seller,erc20Buyer] = await Promise.all([erc20Factory.deploy(),erc20Factory.deploy()])
		
		await registry.connect(account_a).registerProxy()
		let proxy1 = await registry.proxies(account_a.address)
		assert.equal(true, proxy1.length > 0, 'no proxy address for account a')

		await registry.connect(account_b).registerProxy()
		let proxy2 = await registry.proxies(account_b.address)
		assert.equal(true, proxy2.length > 0, 'no proxy address for account b')
		
		await Promise.all([erc20Seller.connect(account_a).approve(proxy1,erc20MintAmountSeller),erc20Buyer.connect(account_b).approve(proxy2,erc20MintAmountBuyer)])
		await Promise.all([erc20Seller.mint(account_a.address,erc20MintAmountSeller),erc20Buyer.mint(account_b.address,erc20MintAmountBuyer)])

		const erc20cSeller = await erc20Factory.deploy()
		const erc20cBuyer = await erc20Factory.deploy()
		const selector = statici.interface.getSighash('anyERC20ForERC20(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
			
		const paramsOne = decoder.encode(
			['address[2]', 'uint256[2]'],
			[[erc20Seller.address, erc20Buyer.address], [sellingPrice, buyingPrice]]
			) 
	
		const paramsTwo = decoder.encode(
			['address[2]', 'uint256[2]'],
			[[erc20Buyer.address, erc20Seller.address], [buyingPrice + takerPriceOffset, sellingPrice]]
		)

		const one = {registry: registry.address, maker: account_a.address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsOne, maximumFill: sellAmount, listingTime: '0', expirationTime: '10000000000', salt: '11'}
		const two = {registry: registry.address, maker: account_b.address, staticTarget: statici.address, staticSelector: selector, staticExtradata: paramsTwo, maximumFill: txCount*sellingPrice*buyAmount, listingTime: '0', expirationTime: '10000000000', salt: '12'}

		const firstData = erc20cSeller.interface.encodeFunctionData('transferFrom', [account_a.address, account_b.address, buyAmount])
		const secondData = erc20cBuyer.interface.encodeFunctionData('transferFrom', [account_b.address, account_a.address, buyAmount * sellingPrice])
		
		const firstCall = {target: erc20Seller.address, howToCall: 0, data: firstData}
		const secondCall = {target: erc20Buyer.address, howToCall: 0, data: secondData}

		let sigOne = await exchange.sign(one, account_a)
		
		for (var i = 0 ; i < txCount ; ++i)
		{
			let sigTwo = await exchange.sign(two, account_b)
			assert.isOk(await exchange.atomicMatchWith(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, { from: sender || account_a}))
			two.salt = two.salt + 1
		}
		
	}

	it('StaticMarket: matches erc20 <> erc20 order, 1 fill',async () =>
		{
		const price = 10000

		return any_erc20_for_erc20_test({
			sellAmount: 1,
			sellingPrice: price,
			buyingPrice: 1,
			buyAmount: 1,
			erc20MintAmountSeller: 1,
			erc20MintAmountBuyer: price,
			account_a: signers[0],
			account_b: signers[6],
			sender: signers[1]
			})
		})

	it('StaticMarket: matches erc20 <> erc20 order, multiple fills in 1 transaction',async () =>
		{
		const amount = 3
		const price = 10000

		return any_erc20_for_erc20_test({
			sellAmount: amount,
			sellingPrice: price,
			buyingPrice: 1,
			buyAmount: amount,
			erc20MintAmountSeller: amount,
			erc20MintAmountBuyer: amount*price,
			account_a: signers[0],
			account_b: signers[6],
			sender: signers[1]
			})
		})

	it('StaticMarket: matches erc20 <> erc20 order, multiple fills in multiple transactions',async () =>
		{
		const sellAmount = 3
		const buyAmount = 1
		const price = 10000
		const transactions = 3

		return any_erc20_for_erc20_test({
			sellAmount,
			sellingPrice: price,
			buyingPrice: 1,
			buyAmount,
			erc20MintAmountSeller: sellAmount,
			erc20MintAmountBuyer: buyAmount*price*transactions,
			account_a: signers[0],
			account_b: signers[6],
			sender: signers[1],
			transactions
			})
		})

	it('StaticMarket: matches erc20 <> erc20 order, allows any partial fill',async () =>
		{
		const sellAmount = 30
		const buyAmount = 4
		const price = 10000

		return any_erc20_for_erc20_test({
			sellAmount,
			sellingPrice: price,
			buyingPrice: 1,
			buyAmount,
			erc20MintAmountSeller: sellAmount,
			erc20MintAmountBuyer: buyAmount*price,
			account_a: signers[0],
			account_b: signers[6],
			sender: signers[1]
			})
		})

	it('StaticMarket: does not match erc20 <> erc20 order beyond maximum fill',async () =>
		{
		const price = 10000

		return expect(
			any_erc20_for_erc20_test({
				sellAmount: 1,
				sellingPrice: price,
				buyingPrice: 1,
				buyAmount: 1,
				erc20MintAmountSeller: 2,
				erc20MintAmountBuyer: price*2,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1],
				transactions: 2
				})
		).to.be.revertedWith('First order has invalid parameters')
	})

	it('StaticMarket: does not fill erc20 <> erc20 order with different taker price', async () =>
		{
		const price = 10000

		return expect(
			any_erc20_for_erc20_test({
				sellAmount: 1,
				sellingPrice: price,
				buyingPrice: 1,
				buyPriceOffset: 1,
				buyAmount: 1,
				erc20MintAmountSeller: 2,
				erc20MintAmountBuyer: price,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1]
				})
		).to.be.revertedWith('Static call failed')
	})

	it('StaticMarket: does not fill erc20 <> erc20 order beyond maximum sell amount',async () =>
		{
		const sellAmount = 2
		const buyAmount = 3
		const price = 10000

		return expect(
			any_erc20_for_erc20_test({
				sellAmount,
				sellingPrice: price,
				buyingPrice: 1,
				buyAmount,
				erc20MintAmountSeller: sellAmount,
				erc20MintAmountBuyer: buyAmount*price,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1]
				})
		).to.be.revertedWith('First call failed')
	})

	it('StaticMarket: does not fill erc20 <> erc20 order if balance is insufficient',async () =>
		{
		const sellAmount = 1
		const buyAmount = 1
		const price = 10000

		return expect(
			any_erc20_for_erc20_test({
				sellAmount,
				sellingPrice: price,
				buyingPrice: 1,
				buyAmount,
				erc20MintAmountSeller: sellAmount,
				erc20MintAmountBuyer: buyAmount*price-1,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1]
				})
		).to.be.revertedWith('Second call failed')
	})

	const erc721_for_erc20_test = async (options) =>
		{
		const {
			tokenId,
			buyTokenId,
			sellingPrice,
			buyingPrice,
			erc20MintAmount,
			account_a,
			account_b,
			sender} = options

		let {exchange, registry, statici} = await deploy_core_contracts()
		const erc721Factory = (await ethers.getContractFactory('TestERC721', signers[0])) as TestERC721__factory;
		let erc721 = await erc721Factory.deploy();
		await erc721.deployed();
		const erc20Factory = (await ethers.getContractFactory('TestERC20', signers[0])) as TestERC20__factory;
		let erc20 = await erc20Factory.deploy();
		await erc20.deployed();
		
		await registry.connect(account_a).registerProxy()
		let proxy1 = await registry.proxies(account_a.address)
		assert.equal(true, proxy1.length > 0, 'no proxy address for account a')

		await registry.connect(account_b).registerProxy()
		let proxy2 = await registry.proxies(account_b.address)
		assert.equal(true, proxy2.length > 0, 'no proxy address for account b')
		
		await Promise.all([erc721.connect(account_a).setApprovalForAll(proxy1,true),erc20.connect(account_b).approve(proxy2,erc20MintAmount)])
		await Promise.all([erc721.mint(account_a.address,tokenId),erc20.mint(account_b.address,erc20MintAmount)])

		if (buyTokenId)
			await erc721.mint(account_a.address,buyTokenId)

		const erc721c = await erc721Factory.deploy()
		const erc20c = await erc20Factory.deploy()
		const selectorOne = statici.interface.getSighash('ERC721ForERC20(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
		const selectorTwo = statici.interface.getSighash('ERC20ForERC721(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
			
		const paramsOne = decoder.encode(
			['address[2]', 'uint256[2]'],
			[[erc721.address, erc20.address], [tokenId, sellingPrice]]
			) 
	
		const paramsTwo = decoder.encode(
			['address[2]', 'uint256[2]'],
			[[erc20.address, erc721.address], [buyTokenId || tokenId, buyingPrice]]
			)
		const one = {registry: registry.address, maker: account_a.address, staticTarget: statici.address, staticSelector: selectorOne, staticExtradata: paramsOne, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: '11'}
		const two = {registry: registry.address, maker: account_b.address, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: paramsTwo, maximumFill: buyingPrice, listingTime: '0', expirationTime: '10000000000', salt: '12'}

		const firstData = erc721c.interface.encodeFunctionData('transferFrom',[account_a.address, account_b.address, tokenId])
		const secondData = erc20c.interface.encodeFunctionData('transferFrom', [account_b.address, account_a.address, buyingPrice])
		
		const firstCall = {target: erc721.address, howToCall: 0, data: firstData}
		const secondCall = {target: erc20.address, howToCall: 0, data: secondData}

		let sigOne = await exchange.sign(one, account_a)
		let sigTwo = await exchange.sign(two, account_b)
		assert.isOk(await exchange.atomicMatchWith(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32,{from: sender || account_a}))

	}

	it('StaticMarket: matches erc721 <> erc20 order',async () =>
	{
		const price = 15000

		return erc721_for_erc20_test({
			tokenId: 10,
			sellingPrice: price,
			buyingPrice: price,
			erc20MintAmount: price,
			account_a: signers[0],
			account_b: signers[6],
			sender: signers[1]
			})
		})

	it('StaticMarket: does not fill erc721 <> erc20 order with different prices',async () =>
		{
		const price = 15000

		return expect(
			erc721_for_erc20_test({
				tokenId: 10,
				sellingPrice: price,
				buyingPrice: price-1,
				erc20MintAmount: price,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1]
				})
		).to.be.revertedWith('Static call failed')
	})

	it('StaticMarket: does not fill erc721 <> erc20 order if the balance is insufficient',async () =>
		{
		const price = 15000

		return expect(
			erc721_for_erc20_test({
				tokenId: 10,
				sellingPrice: price,
				buyingPrice: price,
				erc20MintAmount: price-1,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1]
				})
		).to.be.revertedWith('Second call failed')
	})

	it('StaticMarket: does not fill erc721 <> erc20 order if the token IDs are different',async () =>
		{
		const price = 15000

		return expect(
			erc721_for_erc20_test({
				tokenId: 10,
				buyTokenId: 11,
				sellingPrice: price,
				buyingPrice: price,
				erc20MintAmount: price,
				account_a: signers[0],
				account_b: signers[6],
				sender: signers[1]
				})
		).to.be.revertedWith('Static call failed')
	})
})
