import chai from 'chai';
import asPromised from 'chai-as-promised';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { 
  WyvernRegistry__factory, 
  WyvernRegistry,
  WyvernExchange,
  TestERC20__factory,
  TestERC20,
  TestERC721__factory,
  TestERC721,
  WyvernExchange__factory,
  TestERC1155__factory,
  TestERC1155,
  WyvernStatic,
  WyvernStatic__factory,
  WyvernAtomicizer,
  WyvernAtomicizer__factory,
  StaticMarket,
  StaticMarket__factory,
} from '../build/types';
import { WrappedExchange } from './wrapper';

chai.use(asPromised);

describe('WyvernRegistry', () => {
  let accounts: SignerWithAddress[];
  let registry: WyvernRegistry;
  let atomicizer: WyvernAtomicizer;
  let wyvernStatic: WyvernStatic;
  let staticMarket: StaticMarket;
  let exchange: WyvernExchange;
  let erc20: TestERC20;
	let erc721: TestERC721;
  let erc1155: TestERC1155;

  beforeEach(async () => {
    accounts = await ethers.getSigners();

    const WyvernRegistry = new WyvernRegistry__factory(accounts[0]);
    registry = await WyvernRegistry.deploy();
    await registry.deployed();

    const WyvernAtomicizer = new WyvernAtomicizer__factory(accounts[0]);
    atomicizer = await WyvernAtomicizer.deploy();
    await atomicizer.deployed();

    const WyvernExchange = new WyvernExchange__factory(accounts[0]);
    exchange = await WyvernExchange.deploy(1337, [registry.address], "0x");
    await exchange.deployed();

    const WyvernStaticI = new WyvernStatic__factory(accounts[0]);
    wyvernStatic = await WyvernStaticI.deploy(atomicizer.address);
    await wyvernStatic.deployed();

    const StaticMarket = new StaticMarket__factory(accounts[0]);
    staticMarket = await StaticMarket.deploy();
    await staticMarket.deployed();
		
    await registry.grantInitialAuthentication(exchange.address)

    const TestERC20 = new TestERC20__factory(accounts[0]);
    erc20 = await TestERC20.deploy();
    await erc20.deployed();

		const TestERC721 = new TestERC721__factory(accounts[0]);
    erc721 = await TestERC721.deploy();
    await erc721.deployed();

    const TestERC1155 = new TestERC1155__factory(accounts[0]);
    erc1155 = await TestERC1155.deploy();
    await erc1155.deployed();
  });
	
	describe('erc721 <> erc20 orders', () => {
		const erc721_for_erc20_test = async (options) => {
			const {
				tokenId,
				buyTokenId,
				sellingPrice,
				buyingPrice,
				erc20MintAmount,
				account_a,
				account_b,
			} = options
			
			await registry.connect(account_a).registerProxy();
			let proxyA = await registry.proxies(account_a.address);
	
			await registry.connect(account_b).registerProxy();
			let proxyB = await registry.proxies(account_b.address);
			
			await erc721.connect(account_a).setApprovalForAll(proxyA, true)
			await erc20.connect(account_b).approve(proxyB, erc20MintAmount)
			await erc721.mint(account_a.address, tokenId)
			await erc20.mint(account_b.address, erc20MintAmount)
			

			if (buyTokenId)
				await erc721.mint(account_a.address, buyTokenId)
			
			const wrappedExchangeSeller = new WrappedExchange(account_a, 1337);
			const wrappedExchangeBuyer = new WrappedExchange(account_b, 1337);

			const sellData = await wrappedExchangeSeller.offerERC721ForERC20(erc721.address, tokenId, erc20.address, sellingPrice, '0');
			const buyData = await wrappedExchangeBuyer.offerERC20ForERC721(erc721.address, buyTokenId || tokenId, erc20.address, buyingPrice, '0');

			await wrappedExchangeBuyer.matchERC721ForERC20(sellData.offer, sellData.signature, buyData.offer, buyData.signature)
			let account_a_erc20_balance = await erc20.balanceOf(account_a.address)
			let token_owner = await erc721.ownerOf(tokenId)
			chai.expect(account_a_erc20_balance.toNumber()).to.eq(sellingPrice)
			chai.expect(token_owner).to.eq(account_b.address)
		}

		it('StaticMarket: matches erc721 <> erc20 order', async () => {
			const price = 15000

			return erc721_for_erc20_test({
				tokenId: 10,
				sellingPrice: price,
				buyingPrice: price,
				erc20MintAmount: price,
				account_a: accounts[1],
				account_b: accounts[6],
			})
		})

	it('StaticMarket: does not fill erc721 <> erc20 order with different prices', async () => {
		const price = 15000

		await chai.expect(
			erc721_for_erc20_test({
				tokenId: 10,
				sellingPrice: price,
				buyingPrice: price-1,
				erc20MintAmount: price,
				account_a: accounts[1],
				account_b: accounts[6],
			})
		).eventually.rejectedWith(/Static call failed/)
	})

	it('StaticMarket: does not fill erc721 <> erc20 order if the balance is insufficient', async () => {
		const price = 15000

		await chai.expect(
			erc721_for_erc20_test({
				tokenId: 10,
				sellingPrice: price,
				buyingPrice: price,
				erc20MintAmount: price-1,
				account_a: accounts[1],
				account_b: accounts[6],
			})
		).eventually.rejectedWith(/Second call failed/);
	});

	it('StaticMarket: does not fill erc721 <> erc20 order if the token IDs are different', async () => {
		const price = 15000

		await chai.expect(
			erc721_for_erc20_test({
				tokenId: 10,
				buyTokenId: 11,
				sellingPrice: price,
				buyingPrice: price,
				erc20MintAmount: price,
				account_a: accounts[1],
				account_b: accounts[6],
				})
			).eventually.rejectedWith(/Static call failed/);
		});
	});
});
