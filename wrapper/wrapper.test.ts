import chai from "chai";
import asPromised from "chai-as-promised";
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
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
} from "../dist/build/types";
import { WrappedExchange } from "./wrapper";
import { ZERO_ADDRESS } from "./constants";

chai.use(asPromised);

describe("WyvernRegistry", () => {
  let accounts: SignerWithAddress[];
  let registry: WyvernRegistry;
  let atomicizer: WyvernAtomicizer;
  let wyvernStatic: WyvernStatic;
  let staticMarket: StaticMarket;
  let exchange: WyvernExchange;
  let erc20: TestERC20;
  let erc721: TestERC721;
  let erc1155: TestERC1155;

  const validTokenID = (account) =>
    ethers.BigNumber.from(account.address).mul(
      ethers.BigNumber.from(2).pow(96)
    );

  beforeEach(async () => {
    await network.provider.send("hardhat_reset", []);
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

    await registry.grantInitialAuthentication(exchange.address);

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

  describe("erc1155 <> erc20 orders", () => {
    const any_erc1155_for_erc20_test = async (options: any) => {
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
        transactions,
      } = options;

      const txCount = transactions || 1;

      await registry.connect(account_a).registerProxy();
      const proxyA = await registry.proxies(account_a.address);
      chai.expect(true).to.eq(proxyA.length > 0);

      await registry.connect(account_b).registerProxy();
      const proxyB = await registry.proxies(account_b.address);
      chai.expect(true).to.eq(proxyB.length > 0);

      await erc1155.connect(account_a).setApprovalForAll(proxyA, true);
      await erc20.connect(account_b).approve(proxyB, erc20MintAmount);
      await erc1155["mint(address,uint256,uint256)"](
        account_a.address,
        tokenId,
        erc1155MintAmount
      );
      await erc20.mint(account_b.address, erc20MintAmount);

      if (buyTokenId)
        await erc1155["mint(address,uint256,uint256)"](
          account_a.address,
          buyTokenId,
          erc1155MintAmount
        );

      const wrappedExchangeSeller = new WrappedExchange(account_a, 1337);
      const wrappedExchangeBuyer = new WrappedExchange(account_b, 1337);
      const wrappedExchangeSender = new WrappedExchange(sender, 1337);

      const { order: sellOrder, signature: sellSig } =
        await wrappedExchangeSeller.placeAsk(
          "ERC1155",
          erc1155.address,
          tokenId,
          erc20.address,
          sellingPrice,
          0,
          {
            erc1155SellAmount: sellAmount,
            erc1155SellNumerator: sellingNumerator || 1,
          }
        );
      for (let i = 0; i < txCount; ++i) {
        const { order: buyOrder, signature: buySig } =
          await wrappedExchangeBuyer.placeBid(
            "ERC1155",
            erc1155.address,
            buyTokenId || tokenId,
            erc20.address,
            buyingPrice,
            0,
            {
              erc1155BuyAmount: buyAmount,
              erc1155BuyDenominator: buyingDenominator || 1,
            }
          );
        await wrappedExchangeSender.matchOrders(
          "ERC1155",
          sellOrder,
          sellSig,
          buyOrder,
          buySig,
          sellingNumerator || buyAmount
        );
        buyOrder.salt = buyOrder.salt + 1;
      }

      const account_a_erc20_balance = await erc20.balanceOf(account_a.address);
      const account_b_erc1155_balance = await erc1155.balanceOf(
        account_b.address,
        tokenId
      );
      chai
        .expect(account_a_erc20_balance.toNumber())
        .to.eq(sellingPrice * buyAmount * txCount);
      chai
        .expect(account_b_erc1155_balance.toNumber())
        .to.eq(sellingNumerator || buyAmount * txCount);
    };

    it("StaticMarket: matches erc1155 <> erc20 order, multiple fills in 1 transaction", async () => {
      const amount = 3;
      const price = 10000;

      return any_erc1155_for_erc20_test({
        tokenId: 5,
        sellAmount: amount,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount: amount,
        erc1155MintAmount: amount,
        erc20MintAmount: amount * price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[0],
      });
    });

    it("StaticMarket: matches erc1155 <> erc20 order, multiple fills in multiple transactions", async () => {
      const nftAmount = 3;
      const buyAmount = 1;
      const price = 10000;
      const transactions = 3;

      return any_erc1155_for_erc20_test({
        tokenId: 5,
        sellAmount: nftAmount,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount,
        erc1155MintAmount: nftAmount,
        erc20MintAmount: buyAmount * price * transactions,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[0],
        transactions,
      });
    });

    it("StaticMarket: matches erc1155 <> erc20 order, allows any partial fill", async () => {
      const nftAmount = 30;
      const buyAmount = 4;
      const price = 10000;

      return any_erc1155_for_erc20_test({
        tokenId: 5,
        sellAmount: nftAmount,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount,
        erc1155MintAmount: nftAmount,
        erc20MintAmount: buyAmount * price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[0],
      });
    });

    it("StaticMarket: matches erc1155 <> erc20 order with any matching ratio", async () => {
      const lot = 83974;
      const price = 972;

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
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[0],
      });
    });

    it("StaticMarket: does match erc1155 <> erc20 order beyond maximum fill if seller matches", async () => {
      const price = 10000;

      return any_erc1155_for_erc20_test({
        tokenId: 5,
        sellAmount: 1,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount: 1,
        erc1155MintAmount: 2,
        erc20MintAmount: price * 2,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[0],
        transactions: 2,
      });
    });

    it("StaticMarket: does not fill erc1155 <> erc20 beyond maximum fill if buyer matches", async () => {
      const price = 10000;

      await chai
        .expect(
          any_erc1155_for_erc20_test({
            tokenId: 5,
            sellAmount: 1,
            sellingPrice: price,
            buyingPrice: price,
            buyAmount: 1,
            erc1155MintAmount: 2,
            erc20MintAmount: price * 2,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[6],
            transactions: 2,
          })
        )
        .eventually.rejectedWith(/First order has invalid parameters/);
    });

    it("StaticMarket: does not fill erc1155 <> erc20 order with different prices", async () => {
      const price = 10000;

      await chai
        .expect(
          any_erc1155_for_erc20_test({
            tokenId: 5,
            sellAmount: 1,
            sellingPrice: price,
            buyingPrice: price - 10,
            buyAmount: 1,
            erc1155MintAmount: 1,
            erc20MintAmount: price,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[0],
          })
        )
        .eventually.rejectedWith(/ERC20 buying prices don't match on orders/);
    });

    it("StaticMarket: does not fill erc1155 <> erc20 order with different ratios", async () => {
      const price = 10000;

      await chai
        .expect(
          any_erc1155_for_erc20_test({
            tokenId: 5,
            sellAmount: 1,
            sellingPrice: price,
            buyingPrice: price,
            buyingDenominator: 2,
            buyAmount: 1,
            erc1155MintAmount: 1,
            erc20MintAmount: price,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[0],
          })
        )
        .eventually.rejectedWith(
          /ERC1155 Numerator and Denominator don't match/
        );
    });

    it("StaticMarket: does not fill erc1155 <> erc20 order beyond maximum sell amount", async () => {
      const nftAmount = 2;
      const buyAmount = 3;
      const price = 10000;

      await chai
        .expect(
          any_erc1155_for_erc20_test({
            tokenId: 5,
            sellAmount: nftAmount,
            sellingPrice: price,
            buyingPrice: price,
            buyAmount,
            erc1155MintAmount: nftAmount,
            erc20MintAmount: buyAmount * price,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[0],
          })
        )
        .eventually.rejectedWith(/First call failed/);
    });

    it("StaticMarket: does not fill erc1155 <> erc20 order if balance is insufficient", async () => {
      const nftAmount = 1;
      const buyAmount = 1;
      const price = 10000;

      await chai
        .expect(
          any_erc1155_for_erc20_test({
            tokenId: 5,
            sellAmount: nftAmount,
            sellingPrice: price,
            buyingPrice: price,
            buyAmount,
            erc1155MintAmount: nftAmount,
            erc20MintAmount: buyAmount * price - 1,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[0],
          })
        )
        .eventually.rejectedWith(/Second call failed/);
    });

    it("StaticMarket: does not fill erc1155 <> erc20 order if the token IDs are different", async () => {
      const price = 10000;

      await chai
        .expect(
          any_erc1155_for_erc20_test({
            tokenId: 5,
            buyTokenId: 6,
            sellAmount: 1,
            sellingPrice: price,
            buyingPrice: price,
            buyAmount: 1,
            erc1155MintAmount: 1,
            erc20MintAmount: price,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[0],
          })
        )
        .eventually.rejectedWith(/ERC1155 token IDs don't match on orders/);
    });
  });

  describe("lazy erc1155 <> erc20 orders", () => {
    const lazy_erc1155_for_erc20_test = async (options: any) => {
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
        transactions,
        extraBytes,
      } = options;

      const txCount = transactions || 1;

      await registry.connect(account_a).registerProxy();
      const proxyA = await registry.proxies(account_a.address);
      chai.expect(true).to.eq(proxyA.length > 0);

      await registry.connect(account_b).registerProxy();
      const proxyB = await registry.proxies(account_b.address);
      chai.expect(true).to.eq(proxyB.length > 0);

      await erc20.connect(account_b).approve(proxyB, erc20MintAmount);
      await erc20.mint(account_b.address, erc20MintAmount);
      await erc1155.connect(account_a).setApprovalForAll(proxyA, true);

      if (buyTokenId)
        await erc1155["mint(address,uint256,uint256)"](
          account_a.address,
          buyTokenId,
          erc1155MintAmount
        );

      const wrappedExchangeSeller = new WrappedExchange(account_a, 1337);
      const wrappedExchangeBuyer = new WrappedExchange(account_b, 1337);
      const wrappedExchangeSender = new WrappedExchange(sender, 1337);

      const { order: sellOrder, signature: sellSig } =
        await wrappedExchangeSeller.placeAsk(
          "LazyERC1155",
          erc1155.address,
          tokenId,
          erc20.address,
          sellingPrice,
          0,
          {
            erc1155SellAmount: sellAmount,
            erc1155SellNumerator: sellingNumerator || 1,
            extraBytes,
          }
        );
      for (let i = 0; i < txCount; ++i) {
        const { order: buyOrder, signature: buySig } =
          await wrappedExchangeBuyer.placeBid(
            "LazyERC1155",
            erc1155.address,
            buyTokenId || tokenId,
            erc20.address,
            buyingPrice,
            0,
            {
              erc1155BuyAmount: buyAmount,
              erc1155BuyDenominator: buyingDenominator || 1,
              extraBytes,
            }
          );
        await wrappedExchangeSender.matchOrders(
          "LazyERC1155",
          sellOrder,
          sellSig,
          buyOrder,
          buySig,
          sellingNumerator || buyAmount
        );
        buyOrder.salt = buyOrder.salt + 1;
      }

      const account_a_erc20_balance = await erc20.balanceOf(account_a.address);
      const account_b_erc1155_balance = await erc1155.balanceOf(
        account_b.address,
        tokenId
      );
      chai
        .expect(account_a_erc20_balance.toNumber())
        .to.eq(sellingPrice * buyAmount * txCount);
      chai
        .expect(account_b_erc1155_balance.toNumber())
        .to.eq(sellingNumerator || buyAmount * txCount);
    };

    it("StaticMarket: matches erc1155 <> erc20 order, multiple fills in 1 transaction", async () => {
      const amount = 3;
      const price = 10000;

      return lazy_erc1155_for_erc20_test({
        tokenId: validTokenID(accounts[0]),
        sellAmount: amount,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount: amount,
        erc1155MintAmount: amount,
        erc20MintAmount: amount * price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[0],
        extraBytes: "0x",
      });
    });

    it("StaticMarket: matches erc1155 <> erc20 order, multiple fills in multiple transactions", async () => {
      const nftAmount = 3;
      const buyAmount = 1;
      const price = 10000;
      const transactions = 3;

      return lazy_erc1155_for_erc20_test({
        tokenId: validTokenID(accounts[0]),
        sellAmount: nftAmount,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount,
        erc1155MintAmount: nftAmount,
        erc20MintAmount: buyAmount * price * transactions,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[0],
        transactions,
        extraBytes: "0x",
      });
    });

    it("StaticMarket: matches erc1155 <> erc20 order, allows any partial fill", async () => {
      const nftAmount = 30;
      const buyAmount = 4;
      const price = 10000;

      return lazy_erc1155_for_erc20_test({
        tokenId: validTokenID(accounts[0]),
        sellAmount: nftAmount,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount,
        erc1155MintAmount: nftAmount,
        erc20MintAmount: buyAmount * price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[0],
        extraBytes: "0x",
      });
    });

    it("StaticMarket: matches erc1155 <> erc20 order with any matching ratio", async () => {
      const lot = 83974;
      const price = 972;

      return lazy_erc1155_for_erc20_test({
        tokenId: validTokenID(accounts[0]),
        sellAmount: 6,
        sellingNumerator: lot,
        sellingPrice: price,
        buyingPrice: price,
        buyingDenominator: lot,
        buyAmount: 1,
        erc1155MintAmount: lot,
        erc20MintAmount: price,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[0],
        extraBytes: "0x",
      });
    });

    it("StaticMarket: does match erc1155 <> erc20 order beyond maximum fill if seller matches", async () => {
      const price = 10000;

      return lazy_erc1155_for_erc20_test({
        tokenId: validTokenID(accounts[0]),
        sellAmount: 1,
        sellingPrice: price,
        buyingPrice: price,
        buyAmount: 1,
        erc1155MintAmount: 2,
        erc20MintAmount: price * 2,
        account_a: accounts[0],
        account_b: accounts[6],
        sender: accounts[0],
        transactions: 2,
        extraBytes: "0x",
      });
    });

    it("StaticMarket: does not fill erc1155 <> erc20 beyond maximum fill if buyer matches", async () => {
      const price = 10000;

      await chai
        .expect(
          lazy_erc1155_for_erc20_test({
            tokenId: validTokenID(accounts[0]),
            sellAmount: 1,
            sellingPrice: price,
            buyingPrice: price,
            buyAmount: 1,
            erc1155MintAmount: 2,
            erc20MintAmount: price * 2,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[6],
            transactions: 2,
            extraBytes: "0x",
          })
        )
        .eventually.rejectedWith(/First order has invalid parameters/);
    });

    it("StaticMarket: does not fill erc1155 <> erc20 order with different prices", async () => {
      const price = 10000;

      await chai
        .expect(
          lazy_erc1155_for_erc20_test({
            tokenId: validTokenID(accounts[0]),
            sellAmount: 1,
            sellingPrice: price,
            buyingPrice: price - 10,
            buyAmount: 1,
            erc1155MintAmount: 1,
            erc20MintAmount: price,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[0],
            extraBytes: "0x",
          })
        )
        .eventually.rejectedWith(/ERC20 buying prices don't match on orders/);
    });

    it("StaticMarket: does not fill erc1155 <> erc20 order with different ratios", async () => {
      const price = 10000;

      await chai
        .expect(
          lazy_erc1155_for_erc20_test({
            tokenId: validTokenID(accounts[0]),
            sellAmount: 1,
            sellingPrice: price,
            buyingPrice: price,
            buyingDenominator: 2,
            buyAmount: 1,
            erc1155MintAmount: 1,
            erc20MintAmount: price,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[0],
            extraBytes: "0x",
          })
        )
        .eventually.rejectedWith(
          /ERC1155 Numerator and Denominator don't match/
        );
    });

    it("StaticMarket: does not fill erc1155 <> erc20 order beyond maximum sell amount", async () => {
      const nftAmount = 2;
      const buyAmount = 3;
      const price = 10000;

      await chai
        .expect(
          lazy_erc1155_for_erc20_test({
            tokenId: validTokenID(accounts[0]),
            sellAmount: nftAmount,
            sellingPrice: price,
            buyingPrice: price,
            buyAmount,
            erc1155MintAmount: nftAmount,
            erc20MintAmount: buyAmount * price,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[0],
            extraBytes: "0x",
          })
        )
        .eventually.rejectedWith(/Static call failed/);
    });

    it("StaticMarket: does not fill erc1155 <> erc20 order if balance is insufficient", async () => {
      const nftAmount = 1;
      const buyAmount = 1;
      const price = 10000;

      await chai
        .expect(
          lazy_erc1155_for_erc20_test({
            tokenId: validTokenID(accounts[0]),
            sellAmount: nftAmount,
            sellingPrice: price,
            buyingPrice: price,
            buyAmount,
            erc1155MintAmount: nftAmount,
            erc20MintAmount: buyAmount * price - 1,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[0],
            extraBytes: "0x",
          })
        )
        .eventually.rejectedWith(/Second call failed/);
    });

    it("StaticMarket: does not fill erc1155 <> erc20 order if the token IDs are different", async () => {
      const price = 10000;

      await chai
        .expect(
          lazy_erc1155_for_erc20_test({
            tokenId: validTokenID(accounts[0]),
            buyTokenId: 6,
            sellAmount: 1,
            sellingPrice: price,
            buyingPrice: price,
            buyAmount: 1,
            erc1155MintAmount: 1,
            erc20MintAmount: price,
            account_a: accounts[0],
            account_b: accounts[6],
            sender: accounts[0],
            extraBytes: "0x",
          })
        )
        .eventually.rejectedWith(/ERC1155 token IDs don't match on orders/);
    });
  });

  describe("erc721 <> erc20 orders", () => {
    const erc721_for_erc20_test = async (options: any) => {
      const {
        tokenId,
        buyTokenId,
        sellingPrice,
        buyingPrice,
        erc20MintAmount,
        account_a,
        account_b,
      } = options;

      await registry.connect(account_a).registerProxy();
      const proxyA = await registry.proxies(account_a.address);

      await registry.connect(account_b).registerProxy();
      const proxyB = await registry.proxies(account_b.address);

      await erc721.connect(account_a).setApprovalForAll(proxyA, true);
      await erc20.connect(account_b).approve(proxyB, erc20MintAmount);
      await erc721["mint(address,uint256)"](account_a.address, tokenId);
      await erc20.mint(account_b.address, erc20MintAmount);

      if (buyTokenId)
        await erc721["mint(address,uint256)"](account_a.address, buyTokenId);

      const wrappedExchangeSeller = new WrappedExchange(account_a, 1337);
      const wrappedExchangeBuyer = new WrappedExchange(account_b, 1337);

      const sellData = await wrappedExchangeSeller.placeAsk(
        "ERC721",
        erc721.address,
        tokenId,
        erc20.address,
        sellingPrice,
        0
      );
      const buyData = await wrappedExchangeBuyer.placeBid(
        "ERC721",
        erc721.address,
        buyTokenId || tokenId,
        erc20.address,
        buyingPrice,
        0
      );

      await wrappedExchangeSeller.matchOrders(
        "ERC721",
        sellData.order,
        sellData.signature,
        buyData.order,
        buyData.signature
      );
      const account_a_erc20_balance = await erc20.balanceOf(account_a.address);
      const token_owner = await erc721.ownerOf(tokenId);
      chai.expect(account_a_erc20_balance.toNumber()).to.eq(sellingPrice);
      chai.expect(token_owner).to.eq(account_b.address);
    };

    it("StaticMarket: matches erc721 <> erc20 order", async () => {
      const price = 15000;

      return erc721_for_erc20_test({
        tokenId: 10,
        sellingPrice: price,
        buyingPrice: price,
        erc20MintAmount: price,
        account_a: accounts[1],
        account_b: accounts[6],
      });
    });

    it("StaticMarket: does not fill erc721 <> erc20 order with different prices", async () => {
      const price = 15000;
      // note: this will also reject on-chain
      await chai
        .expect(
          erc721_for_erc20_test({
            tokenId: 10,
            sellingPrice: price,
            buyingPrice: price - 1,
            erc20MintAmount: price,
            account_a: accounts[1],
            account_b: accounts[6],
          })
        )
        .eventually.rejectedWith(/ERC20 buying prices don't match on orders/);
    });

    it("StaticMarket: does not fill erc721 <> erc20 order if the balance is insufficient", async () => {
      const price = 15000;

      await chai
        .expect(
          erc721_for_erc20_test({
            tokenId: 10,
            sellingPrice: price,
            buyingPrice: price,
            erc20MintAmount: price - 1,
            account_a: accounts[1],
            account_b: accounts[6],
          })
        )
        .eventually.rejectedWith(/Second call failed/);
    });

    it("StaticMarket: does not fill erc721 <> erc20 order if the token IDs are different", async () => {
      const price = 15000;
      // note: this will also reject on-chain
      await chai
        .expect(
          erc721_for_erc20_test({
            tokenId: 10,
            buyTokenId: 11,
            sellingPrice: price,
            buyingPrice: price,
            erc20MintAmount: price,
            account_a: accounts[1],
            account_b: accounts[6],
          })
        )
        .eventually.rejectedWith(/ERC721 token IDs don't match on orders/);
    });
  });

  describe("lazy erc721 <> erc20 orders", () => {
    const erc721_for_erc20_test = async (options: any) => {
      const {
        tokenId,
        buyTokenId,
        sellingPrice,
        buyingPrice,
        erc20MintAmount,
        account_a,
        account_b,
        extraBytes,
      } = options;

      await registry.connect(account_a).registerProxy();
      const proxyA = await registry.proxies(account_a.address);

      await registry.connect(account_b).registerProxy();
      const proxyB = await registry.proxies(account_b.address);

      await erc20.connect(account_b).approve(proxyB, erc20MintAmount);
      await erc20.mint(account_b.address, erc20MintAmount);
      await erc721.connect(account_a).setApprovalForAll(proxyA, true);

      if (buyTokenId)
        await erc721["mint(address,uint256)"](account_a.address, buyTokenId);

      const wrappedExchangeSeller = new WrappedExchange(account_a, 1337);
      const wrappedExchangeBuyer = new WrappedExchange(account_b, 1337);

      const sellData = await wrappedExchangeSeller.placeAsk(
        "LazyERC721",
        erc721.address,
        tokenId,
        erc20.address,
        sellingPrice,
        0,
        { extraBytes }
      );
      const buyData = await wrappedExchangeBuyer.placeBid(
        "LazyERC721",
        erc721.address,
        buyTokenId || tokenId,
        erc20.address,
        buyingPrice,
        0,
        { extraBytes }
      );

      await wrappedExchangeSeller.matchOrders(
        "LazyERC721",
        sellData.order,
        sellData.signature,
        buyData.order,
        buyData.signature
      );
      const account_a_erc20_balance = await erc20.balanceOf(account_a.address);
      const token_owner = await erc721.ownerOf(tokenId);
      chai.expect(account_a_erc20_balance.toNumber()).to.eq(sellingPrice);
      chai.expect(token_owner).to.eq(account_b.address);
    };

    it("StaticMarket: matches erc721 <> erc20 order", async () => {
      const price = 15000;

      return erc721_for_erc20_test({
        tokenId: validTokenID(accounts[1]),
        sellingPrice: price,
        buyingPrice: price,
        erc20MintAmount: price,
        account_a: accounts[1],
        account_b: accounts[6],
        extraBytes: "0x",
      });
    });

    it("StaticMarket: does not fill erc721 <> erc20 order with different prices", async () => {
      const price = 15000;
      // note: this will also reject on-chain
      await chai
        .expect(
          erc721_for_erc20_test({
            tokenId: validTokenID(accounts[1]),
            sellingPrice: price,
            buyingPrice: price - 1,
            erc20MintAmount: price,
            account_a: accounts[1],
            account_b: accounts[6],
            extraBytes: "0x",
          })
        )
        .eventually.rejectedWith(/ERC20 buying prices don't match on orders/);
    });

    it("StaticMarket: does not fill erc721 <> erc20 order if the balance is insufficient", async () => {
      const price = 15000;

      await chai
        .expect(
          erc721_for_erc20_test({
            tokenId: validTokenID(accounts[1]),
            sellingPrice: price,
            buyingPrice: price,
            erc20MintAmount: price - 1,
            account_a: accounts[1],
            account_b: accounts[6],
            extraBytes: "0x",
          })
        )
        .eventually.rejectedWith(/Second call failed/);
    });

    it("StaticMarket: does not fill erc721 <> erc20 order if the token IDs are different", async () => {
      const price = 15000;
      // note: this will also reject on-chain
      await chai
        .expect(
          erc721_for_erc20_test({
            tokenId: validTokenID(accounts[1]),
            buyTokenId: 11,
            sellingPrice: price,
            buyingPrice: price,
            erc20MintAmount: price,
            account_a: accounts[1],
            account_b: accounts[6],
            extraBytes: "0x",
          })
        )
        .eventually.rejectedWith(/ERC721 token IDs don't match on orders/);
    });

    it("throws if tokenId does not match maker", async () => {
      const price = 15000;

      await chai
        .expect(
          erc721_for_erc20_test({
            tokenId: 0,
            sellingPrice: price,
            buyingPrice: price,
            erc20MintAmount: price,
            account_a: accounts[1],
            account_b: accounts[6],
            extraBytes: "0x",
          })
        )
        .eventually.rejectedWith(/First call failed/);
    });
  });

  describe("cancelOrder", () => {
    let wrappedExchange;
    const sellingPrice = 1000000;
    const sellAmount = 5;

    beforeEach(() => {
      wrappedExchange = new WrappedExchange(accounts[0], 1337);
    });

    const getOrderHash = async (order): Promise<string> => {
      return await exchange.hashOrder_(
        order.registry,
        order.maker,
        order.staticTarget,
        order.staticSelector,
        order.staticExtradata,
        order.maximumFill,
        order.listingTime,
        order.expirationTime,
        order.salt
      );
    };

    it("sets the correct fill of an ERC20 order", async () => {
      const { order } = await wrappedExchange.placeBid(
        "ERC721",
        erc721.address,
        0,
        erc20.address,
        sellingPrice,
        0
      );
      await wrappedExchange.cancelOrder(order);
      const orderHash = await getOrderHash(order);

      chai
        .expect(await exchange.fills(accounts[0].address, orderHash))
        .to.eq(sellingPrice);
    });

    it("sets the correct fill of an ERC721 order", async () => {
      const { order } = await wrappedExchange.placeAsk(
        "ERC721",
        erc721.address,
        0,
        erc20.address,
        sellingPrice,
        0
      );
      await wrappedExchange.cancelOrder(order);
      const orderHash = await getOrderHash(order);

      chai
        .expect(await exchange.fills(accounts[0].address, orderHash))
        .to.eq(1);
    });

    it("sets the correct fill of an ERC1155 order", async () => {
      const { order } = await wrappedExchange.placeAsk(
        "ERC1155",
        erc1155.address,
        0,
        erc20.address,
        sellingPrice,
        0,
        { erc1155SellAmount: sellAmount, erc1155SellNumerator: 1 }
      );
      await wrappedExchange.cancelOrder(order);
      const orderHash = await getOrderHash(order);

      chai
        .expect(await exchange.fills(accounts[0].address, orderHash))
        .to.eq(sellAmount);
    });
  });

  describe("getOrRegisterProxy", () => {
    let wrappedExchange;
    beforeEach(() => {
      wrappedExchange = new WrappedExchange(accounts[0], 1337);
    });

    it("creates a new proxy when the user does not have a proxy", async () => {
      const proxy = await wrappedExchange.getOrRegisterProxy();
      chai.expect(proxy.address === ZERO_ADDRESS).to.eq(false);
    });

    it("returns proxy address when the user does have a proxy", async () => {
      await registry.connect(accounts[0]).registerProxy();
      chai
        .expect((await wrappedExchange.getOrRegisterProxy()).address)
        .to.eq(await registry.proxies(accounts[0].address));
    });
  });

  describe("getOrIncreaseApproval", () => {
    let wrappedExchange;
    let amount;
    let account_a;
    let erc20;
    let erc721;
    let erc1155;
    beforeEach(async () => {
      wrappedExchange = new WrappedExchange(accounts[0], 1337);
      amount = ethers.BigNumber.from("100");
      account_a = accounts[0];

      const ERC20 = new TestERC20__factory(accounts[0]);
      erc20 = await ERC20.deploy();
      await erc20.deployed();

      const ERC721 = new TestERC721__factory(accounts[0]);
      erc721 = await ERC721.deploy();
      await erc721.deployed();

      const ERC1155 = new TestERC1155__factory(accounts[0]);
      erc1155 = await ERC1155.deploy();
      await erc1155.deployed();
    });

    const registerProxy = async () => {
      await registry.connect(account_a).registerProxy();
      return await registry.proxies(account_a.address);
    };

    it("throws if the user does not have a proxy", async () => {
      chai.assert.isRejected(
        wrappedExchange.getOrIncreaseApproval("ERC20", erc20.address, amount),
        "Signer does not have a proxy registered"
      );
    });

    it("throws if the wrong ERC is passed in", async () => {
      await registerProxy();
      chai.assert.isRejected(
        wrappedExchange.getOrIncreaseApproval("ERC50", erc20.address, amount),
        "This method only works for ERC20, 721, or 1155 tokens"
      );
    });

    it("returns the correct ERC20 approval", async () => {
      const proxy = await registerProxy();
      await erc20.connect(account_a).approve(proxy, amount);
      const approval = await wrappedExchange.getOrIncreaseApproval(
        "ERC20",
        erc20.address,
        amount
      );
      chai.expect(approval).to.eq(amount);
    });

    it("asks for ERC20 approval if not approved", async () => {
      await registerProxy();
      const approval = await wrappedExchange.getOrIncreaseApproval(
        "ERC20",
        erc20.address,
        amount
      );
      chai.expect(approval).to.eq(amount);
    });

    it("returns the correct ERC721 approval", async () => {
      await erc721["mint(address,uint256)"](account_a.address, 0);
      const proxy = await registerProxy();
      await erc721.connect(account_a).approve(proxy, 0);

      chai
        .expect(
          await wrappedExchange.getOrIncreaseApproval("ERC721", erc721.address)
        )
        .to.eq(true);
    });

    it("asks for ERC721 approval if not approved", async () => {
      await erc721["mint(address,uint256)"](account_a.address, 0);
      await registerProxy();

      chai
        .expect(
          await wrappedExchange.getOrIncreaseApproval("ERC721", erc721.address)
        )
        .to.eq(true);
    });

    it("returns the correct ERC71155 approval", async () => {
      await erc1155["mint(address,uint256,uint256)"](account_a.address, 0, 5);
      const proxy = await registerProxy();
      await erc1155.connect(account_a).setApprovalForAll(proxy, true);

      chai
        .expect(
          await wrappedExchange.getOrIncreaseApproval(
            "ERC1155",
            erc1155.address
          )
        )
        .to.eq(true);
    });

    it("asks for ERC1155 approval if not approved", async () => {
      await erc1155["mint(address,uint256,uint256)"](account_a.address, 0, 5);
      await registerProxy();

      chai
        .expect(
          await wrappedExchange.getOrIncreaseApproval(
            "ERC1155",
            erc1155.address
          )
        )
        .to.eq(true);
    });
  });

  // describe('erc20 <> erc20 orders', () => {
  //   const any_erc20_for_erc20_test = async (options: any) => {
  //     const {
  //       sellAmount,
  //       sellingPrice,
  //       buyingPrice,
  //       buyPriceOffset,
  //       buyAmount,
  //       erc20MintAmountSeller,
  //       erc20MintAmountBuyer,
  //       account_a,
  //       account_b,
  //       sender,
  //       transactions
  //     } = options;

  //     const txCount = transactions || 1;
  //     const takerPriceOffset = buyPriceOffset || 0;

  //     const TestERC20 = new TestERC20__factory(accounts[0]);
  //     const erc20Seller = await TestERC20.deploy();
  //     await erc20Seller.deployed();
  //     const erc20Buyer = await TestERC20.deploy();
  //     await erc20.deployed();

  //     await registry.connect(account_a).registerProxy();
  //     const proxyA = await registry.proxies(account_a.address);
  //     chai.expect(true).to.eq(proxyA.length > 0);

  //     await registry.connect(account_b).registerProxy();
  //     const proxyB = await registry.proxies(account_b.address);
  //     chai.expect(true).to.eq(proxyB.length > 0);

  //     await erc20Seller.connect(account_a).approve(proxyA, erc20MintAmountSeller);
  //     await erc20Buyer.connect(account_b).approve(proxyB, erc20MintAmountBuyer);
  //     await erc20Seller.mint(account_a.address, erc20MintAmountSeller);
  //     await erc20Buyer.mint(account_b.address, erc20MintAmountBuyer);

  //     const wrappedExchangeSeller = new WrappedExchange(account_a, 1337);
  //     const wrappedExchangeBuyer = new WrappedExchange(account_b, 1337);
  //     const wrappedExchangeSender = new WrappedExchange(sender, 1337);

  //     const { order: sellOrder, signature: sellSig } = await wrappedExchangeSeller.offerERC20ForERC20(erc20Seller.address, sellingPrice, sellAmount, erc20Buyer.address, buyingPrice, '0');

  //     for (let i = 0 ; i < txCount ; ++i) {
  //       const { order: buyOrder, signature: buySig } = await wrappedExchangeBuyer.offerERC20ForERC20(erc20Buyer.address, buyingPrice + takerPriceOffset, txCount*sellingPrice*buyAmount, erc20Seller.address, sellingPrice, '0');
  //       await wrappedExchangeSender.matchERC20ForERC20(sellOrder, sellSig, buyOrder, buySig, buyAmount);
  //       buyOrder.salt = buyOrder.salt + 1;
  //     }

  //     const account_a_erc20_balance = await erc20Buyer.balanceOf(account_a.address);
  //     const account_b_erc20_balance = await erc20Seller.balanceOf(account_b.address);
  //     chai.expect(account_a_erc20_balance.toNumber()).to.eq(sellingPrice*buyAmount*txCount);
  //     chai.expect(account_b_erc20_balance.toNumber()).to.eq(buyAmount*txCount);
  //   };

  //   it('StaticMarket: matches erc20 <> erc20 order, 1 fill', async () => {
  //     const price = 10000;

  //     return any_erc20_for_erc20_test({
  //       sellAmount: 1,
  //       sellingPrice: price,
  //       buyingPrice: 1,
  //       buyAmount: 1,
  //       erc20MintAmountSeller: 1,
  //       erc20MintAmountBuyer: price,
  //       account_a: accounts[0],
  //       account_b: accounts[6],
  //       sender: accounts[1]
  //     });
  //   });

  //   it('StaticMarket: matches erc20 <> erc20 order, multiple fills in 1 transaction',async () =>
  //   {
  //     const amount = 3;
  //     const price = 10000;

  //     return any_erc20_for_erc20_test({
  //       sellAmount: amount,
  //       sellingPrice: price,
  //       buyingPrice: 1,
  //       buyAmount: amount,
  //       erc20MintAmountSeller: amount,
  //       erc20MintAmountBuyer: amount*price,
  //       account_a: accounts[0],
  //       account_b: accounts[6],
  //       sender: accounts[1]
  //     });
  //   });

  //   it('StaticMarket: matches erc20 <> erc20 order, multiple fills in multiple transactions',async () =>
  //   {
  //     const sellAmount = 3;
  //     const buyAmount = 1;
  //     const price = 10000;
  //     const transactions = 3;

  //     return any_erc20_for_erc20_test({
  //       sellAmount,
  //       sellingPrice: price,
  //       buyingPrice: 1,
  //       buyAmount,
  //       erc20MintAmountSeller: sellAmount,
  //       erc20MintAmountBuyer: buyAmount*price*transactions,
  //       account_a: accounts[0],
  //       account_b: accounts[6],
  //       sender: accounts[1],
  //       transactions
  //     });
  //   });

  //   it('StaticMarket: matches erc20 <> erc20 order, allows any partial fill',async () =>
  //   {
  //     const sellAmount = 30;
  //     const buyAmount = 4;
  //     const price = 10000;

  //     return any_erc20_for_erc20_test({
  //       sellAmount,
  //       sellingPrice: price,
  //       buyingPrice: 1,
  //       buyAmount,
  //       erc20MintAmountSeller: sellAmount,
  //       erc20MintAmountBuyer: buyAmount*price,
  //       account_a: accounts[0],
  //       account_b: accounts[6],
  //       sender: accounts[1]
  //     });
  //   });

  //   it('StaticMarket: does not match erc20 <> erc20 order beyond maximum fill',async () =>
  //   {
  //     const price = 10000;

  //     await chai.expect(
  //       any_erc20_for_erc20_test({
  //         sellAmount: 1,
  //         sellingPrice: price,
  //         buyingPrice: 1,
  //         buyAmount: 1,
  //         erc20MintAmountSeller: 2,
  //         erc20MintAmountBuyer: price*2,
  //         account_a: accounts[0],
  //         account_b: accounts[6],
  //         sender: accounts[1], // depending on who fills, it actually will allow beyond max fill because msg.sender's fill is not updated
  //         transactions: 2
  //       })
  //     ).eventually.rejectedWith(/First order has invalid parameters/);
  //   });

  //   it('StaticMarket: does not fill erc20 <> erc20 order with different taker price',async () =>
  //   {
  //     const price = 10000;

  //     await chai.expect(
  //       any_erc20_for_erc20_test({
  //         sellAmount: 1,
  //         sellingPrice: price,
  //         buyingPrice: 1,
  //         buyPriceOffset: 1,
  //         buyAmount: 1,
  //         erc20MintAmountSeller: 2,
  //         erc20MintAmountBuyer: price,
  //         account_a: accounts[0],
  //         account_b: accounts[6],
  //         sender: accounts[1]
  //       })
  //     ).eventually.rejectedWith(/ERC20 buying prices don't match on orders/);
  //   });

  //   it('StaticMarket: does not fill erc20 <> erc20 order beyond maximum sell amount',async () =>
  //   {
  //     const sellAmount = 2;
  //     const buyAmount = 3;
  //     const price = 10000;

  //     await chai.expect(
  //       any_erc20_for_erc20_test({
  //         sellAmount,
  //         sellingPrice: price,
  //         buyingPrice: 1,
  //         buyAmount,
  //         erc20MintAmountSeller: sellAmount,
  //         erc20MintAmountBuyer: buyAmount*price,
  //         account_a: accounts[0],
  //         account_b: accounts[6],
  //         sender: accounts[1]
  //       })
  //     ).eventually.rejectedWith(/First call failed/);
  //   });

  //   it('StaticMarket: does not fill erc20 <> erc20 order if balance is insufficient',async () =>
  //   {
  //     const sellAmount = 1;
  //     const buyAmount = 1;
  //     const price = 10000;

  //     await chai.expect(
  //       any_erc20_for_erc20_test({
  //         sellAmount,
  //         sellingPrice: price,
  //         buyingPrice: 1,
  //         buyAmount,
  //         erc20MintAmountSeller: sellAmount,
  //         erc20MintAmountBuyer: buyAmount*price-1,
  //         account_a: accounts[0],
  //         account_b: accounts[6],
  //         sender: accounts[1]
  //       })
  //     ).eventually.rejectedWith(/Second call failed/);
  //   });
  // });
});
