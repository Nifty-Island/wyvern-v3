import {
  ethers,
  Signer,
  BigNumber,
  Transaction,
  ContractTransaction,
} from "ethers";
import {
  ZERO_BYTES32,
  ZERO_ADDRESS,
  eip712Order,
  anyERC1155ForERC20Selector,
  anyERC20ForERC1155Selector,
  anyERC20ForERC20Selector,
  ERC721ForERC20Selector,
  ERC20ForERC721Selector,
  LazyERC721ForERC20Selector,
  LazyERC20ForERC721Selector,
  LazyERC1155ForERC20Selector,
  LazyERC20ForERC1155Selector,
  ERC20Interface,
  ERC721Interface,
  ERC1155Interface,
  tokenTypes,
  zero,
} from "./constants";
import type { WyvernSystem, Order, Sig, Call, EIP712Domain } from "./types";
import {
  WyvernExchange,
  WyvernExchange__factory,
  WyvernRegistry,
  WyvernRegistry__factory,
  OwnableDelegateProxy,
  OwnableDelegateProxy__factory,
  ERC20__factory,
  ERC721__factory,
  ERC1155__factory,
} from "../dist/build/types";
import addressesByChainId from "./addresses.json";

export class WrappedExchange {
  public exchange: WyvernExchange;
  public registry: WyvernRegistry;
  public addresses: WyvernSystem;
  public signer: Signer | any; // Signer but also implements _signTypedData
  public chainId: number;
  public EIP712Domain: EIP712Domain;

  constructor(signer: Signer, chainId: number) {
    this.signer = signer;
    this.chainId = chainId;
    this.addresses = addressesByChainId[chainId];
    this.exchange = WyvernExchange__factory.connect(
      this.addresses.WyvernExchange,
      signer
    );
    this.registry = WyvernRegistry__factory.connect(
      this.addresses.WyvernRegistry,
      signer
    );
    this.EIP712Domain = {
      name: "Wyvern Exchange",
      version: "3.1",
      chainId,
      verifyingContract: this.exchange.address,
    };
  }

  // utility functions
  private async sign(order: Order): Promise<Sig> {
    // see https://docs.ethers.io/v5/api/signer/#Signer-signTypedData

    return this.signer
      ._signTypedData(this.EIP712Domain, { Order: eip712Order.fields }, order)
      .then((sigBytes: string) => {
        sigBytes = sigBytes.substr(2);
        const r = "0x" + sigBytes.slice(0, 64);
        const s = "0x" + sigBytes.slice(64, 128);
        const v = parseInt("0x" + sigBytes.slice(128, 130), 16);
        return { v, r, s };
      });
  }

  /**
   * Reorganises the order and signature structs for the atomicMatch_() call on Exchange.sol
   * @param order
   * @param sig
   * @param call The function call being proxied by  wyvern, often a transferFrom() or safeTransferFrom()
   * @param counterorder
   * @param countersig
   * @param countercall The function call being proxied by  wyvern, often a transferFrom() or safeTransferFrom()
   * @param metadata
   * @returns on-chain transaction details
   */
  private async atomicMatch(
    order: Order,
    sig: Sig,
    call: Call,
    counterorder: Order,
    countersig: Sig,
    countercall: Call,
    metadata: string
  ): Promise<ContractTransaction> {
    return await this.exchange.atomicMatch_(
      [
        order.registry,
        order.maker,
        order.staticTarget,
        order.maximumFill,
        order.listingTime,
        order.expirationTime,
        order.salt,
        call.target,
        counterorder.registry,
        counterorder.maker,
        counterorder.staticTarget,
        counterorder.maximumFill,
        counterorder.listingTime,
        counterorder.expirationTime,
        counterorder.salt,
        countercall.target,
      ],
      [order.staticSelector, counterorder.staticSelector],
      order.staticExtradata,
      call.data,
      counterorder.staticExtradata,
      countercall.data,
      [call.howToCall, countercall.howToCall],
      metadata,
      ethers.utils.defaultAbiCoder.encode(
        ["bytes", "bytes"],
        [
          ethers.utils.defaultAbiCoder.encode(
            ["uint8", "bytes32", "bytes32"],
            [sig.v, sig.r, sig.s]
          ),
          ethers.utils.defaultAbiCoder.encode(
            ["uint8", "bytes32", "bytes32"],
            [countersig.v, countersig.r, countersig.s]
          ),
        ]
      )
    );
  }

  private generateSalt(): number {
    return Math.floor(Math.random() * 10000);
  }

  /**
   * returns the exact timestamp of the latest block
   * another way to do this is to just grab the current unix timestamp from javascript `~~(Date.now()/1000)`
   * @returns unix timestamp of the last blocknumber
   */
  private async getBlockTimestamp(): Promise<number> {
    const blockNumber = await this.signer.provider.getBlockNumber();
    return (await this.signer.provider.getBlock(blockNumber)).timestamp;
  }

  private async getOrderHash(order: Order): Promise<string> {
    return this.exchange.hashOrder_(
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
  }

  private async offerERC721ForERC20(
    erc721Address: string,
    erc721Id: BigNumber,
    erc20Address: string,
    erc20SellPrice: BigNumber,
    expirationTime: number
  ): Promise<{ order: Order; signature: Sig; orderHash: string }> {
    const maker = await this.signer.getAddress();

    // static extradata for both the order and counter order are checked during the StaticMarket calls
    const staticExtradata = ethers.utils.defaultAbiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc721Address, erc20Address],
        [erc721Id, erc20SellPrice],
      ]
    );
    const order = {
      registry: this.addresses.WyvernRegistry,
      maker,
      staticTarget: this.addresses.StaticMarket,
      staticSelector: ERC721ForERC20Selector,
      staticExtradata,
      maximumFill: "1",
      listingTime: await this.getBlockTimestamp(),
      expirationTime,
      salt: this.generateSalt(),
    };

    const signature = await this.sign(order); // calls out to the signer (wallet, often Metamask)
    const orderHash = await this.getOrderHash(order);

    return { order, signature, orderHash };
  }

  private async offerERC20ForERC721(
    erc721Address: string,
    erc721Id: BigNumber,
    erc20Address: string,
    erc20BuyPrice: BigNumber,
    expirationTime: number
  ): Promise<{ order: Order; signature: Sig; orderHash: string }> {
    const maker = await this.signer.getAddress();

    // static extradata for both the order and counter order are checked during the StaticMarket calls
    const staticExtradata = ethers.utils.defaultAbiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc20Address, erc721Address],
        [erc721Id, erc20BuyPrice],
      ]
    );
    const order = {
      registry: this.addresses.WyvernRegistry,
      maker,
      staticTarget: this.addresses.StaticMarket,
      staticSelector: ERC20ForERC721Selector,
      staticExtradata,
      maximumFill: erc20BuyPrice.toString(),
      listingTime: await this.getBlockTimestamp(),
      expirationTime: expirationTime,
      salt: this.generateSalt(),
    };

    const signature = await this.sign(order); // calls out to the signer (wallet, often Metamask)
    const orderHash = await this.getOrderHash(order);

    return { order, signature, orderHash };
  }

  private async matchERC721ForERC20(
    sellOrder: Order,
    sellSig: Sig,
    buyOrder: Order,
    buySig: Sig
  ): Promise<Transaction> {
    const [[erc721Address, erc20Address], [tokenId, buyingPrice]] =
      ethers.utils.defaultAbiCoder.decode(
        ["address[2]", "uint256[2]"],
        sellOrder.staticExtradata
      );
    const [
      [erc20AddressOther, erc721AddressOther],
      [tokenIdOther, buyingPriceOther],
    ] = ethers.utils.defaultAbiCoder.decode(
      ["address[2]", "uint256[2]"],
      buyOrder.staticExtradata
    );

    // these checks are also performed within the static calls on StaticMarket, but we check here before going on chain
    if (erc721Address != erc721AddressOther)
      throw new Error("ERC721 Addresses don't match on orders");
    if (erc20Address != erc20AddressOther)
      throw new Error("ERC20 Addresses don't match on orders");
    if (!tokenId.eq(tokenIdOther))
      throw new Error("ERC721 token IDs don't match on orders");
    if (!buyingPrice.eq(buyingPriceOther))
      throw new Error("ERC20 buying prices don't match on orders");

    const firstData = ERC721Interface.encodeFunctionData("transferFrom", [
      sellOrder.maker,
      buyOrder.maker,
      tokenId,
    ]); // this might be weird bc passing in BigNumbers...
    const secondData = ERC20Interface.encodeFunctionData("transferFrom", [
      buyOrder.maker,
      sellOrder.maker,
      buyingPrice,
    ]);

    const firstCall = { target: erc721Address, howToCall: 0, data: firstData };
    const secondCall = { target: erc20Address, howToCall: 0, data: secondData };

    return await this.atomicMatch(
      sellOrder,
      sellSig,
      firstCall,
      buyOrder,
      buySig,
      secondCall,
      ZERO_BYTES32
    );
  }

  private async offerLazyERC721ForERC20(
    erc721Address: string,
    erc721Id: BigNumber,
    erc20Address: string,
    erc20SellPrice: BigNumber,
    expirationTime: number,
    extraBytes: string
  ): Promise<{ order: Order; signature: Sig; orderHash: string }> {
    const maker = await this.signer.getAddress();
    const staticExtradata = ethers.utils.defaultAbiCoder.encode(
      ["address[2]", "uint256[2]", "bytes"],
      [[erc721Address, erc20Address], [erc721Id, erc20SellPrice], extraBytes]
    );
    const order = {
      registry: this.addresses.WyvernRegistry,
      maker,
      staticTarget: this.addresses.StaticMarket,
      staticSelector: LazyERC721ForERC20Selector,
      staticExtradata,
      maximumFill: "1",
      listingTime: await this.getBlockTimestamp(),
      expirationTime,
      salt: this.generateSalt(),
    };

    const signature = await this.sign(order);
    const orderHash = await this.getOrderHash(order);

    return { order, signature, orderHash };
  }

  private async offerERC20ForLazyERC721(
    erc721Address: string,
    erc721Id: BigNumber,
    erc20Address: string,
    erc20BuyPrice: BigNumber,
    expirationTime: number,
    extraBytes: string
  ): Promise<{ order: Order; signature: Sig; orderHash: string }> {
    const maker = await this.signer.getAddress();

    // static extradata for both the order and counter order are checked during the StaticMarket calls
    const staticExtradata = ethers.utils.defaultAbiCoder.encode(
      ["address[2]", "uint256[2]", "bytes"],
      [[erc20Address, erc721Address], [erc721Id, erc20BuyPrice], extraBytes]
    );
    const order = {
      registry: this.addresses.WyvernRegistry,
      maker,
      staticTarget: this.addresses.StaticMarket,
      staticSelector: LazyERC20ForERC721Selector,
      staticExtradata,
      maximumFill: erc20BuyPrice.toString(),
      listingTime: await this.getBlockTimestamp(),
      expirationTime: expirationTime,
      salt: this.generateSalt(),
    };

    const signature = await this.sign(order);
    const orderHash = await this.getOrderHash(order);

    return { order, signature, orderHash };
  }

  private async matchLazy721ForERC20(
    sellOrder: Order,
    sellSig: Sig,
    buyOrder: Order,
    buySig: Sig
  ) {
    const [[erc721Address, erc20Address], [tokenId, buyingPrice], extraBytes] =
      ethers.utils.defaultAbiCoder.decode(
        ["address[2]", "uint256[2]", "bytes"],
        sellOrder.staticExtradata
      );
    const [
      [erc20AddressOther, erc721AddressOther],
      [tokenIdOther, buyingPriceOther],
      extraBytesOther,
    ] = ethers.utils.defaultAbiCoder.decode(
      ["address[2]", "uint256[2]", "bytes"],
      buyOrder.staticExtradata
    );

    // these checks are also performed within the static calls on StaticMarket, but we check here before going on chain
    if (erc721Address != erc721AddressOther)
      throw new Error("ERC721 Addresses don't match on orders");
    if (erc20Address != erc20AddressOther)
      throw new Error("ERC20 Addresses don't match on orders");
    if (!tokenId.eq(tokenIdOther))
      throw new Error("ERC721 token IDs don't match on orders");
    if (!buyingPrice.eq(buyingPriceOther))
      throw new Error("ERC20 buying prices don't match on orders");

    if (extraBytes != extraBytesOther)
      throw new Error("Lazy mint extraBytes don't match on orders");

    const firstData = ERC721Interface.encodeFunctionData(
      "mint(address,uint256,bytes)",
      [buyOrder.maker, tokenId, extraBytes]
    );
    const secondData = ERC20Interface.encodeFunctionData("transferFrom", [
      buyOrder.maker,
      sellOrder.maker,
      buyingPrice,
    ]);

    const firstCall = { target: erc721Address, howToCall: 0, data: firstData };
    const secondCall = { target: erc20Address, howToCall: 0, data: secondData };

    return await this.atomicMatch(
      sellOrder,
      sellSig,
      firstCall,
      buyOrder,
      buySig,
      secondCall,
      ZERO_BYTES32
    );
  }

  private async offerERC1155ForERC20(
    erc1155Address: string,
    erc1155Id: BigNumber,
    erc1155SellAmount: BigNumber,
    erc1155SellNumerator: BigNumber,
    erc20Address: string,
    erc20SellPrice: BigNumber,
    expirationTime: number
  ): Promise<{ order: Order; signature: Sig; orderHash: string }> {
    const maker = await this.signer.getAddress();

    // static extradata for both the order and counter order are checked during the StaticMarket calls
    const staticExtradata = ethers.utils.defaultAbiCoder.encode(
      ["address[2]", "uint256[3]"],
      [
        [erc1155Address, erc20Address],
        [erc1155Id, erc1155SellNumerator, erc20SellPrice],
      ]
    );
    const order = {
      registry: this.addresses.WyvernRegistry,
      maker,
      staticTarget: this.addresses.StaticMarket,
      staticSelector: anyERC1155ForERC20Selector,
      staticExtradata,
      maximumFill: BigNumber.from(erc1155SellNumerator)
        .mul(BigNumber.from(erc1155SellAmount))
        .toString(),
      listingTime: await this.getBlockTimestamp(),
      expirationTime: expirationTime,
      salt: this.generateSalt(),
    };

    const signature = await this.sign(order);
    const orderHash = await this.getOrderHash(order);

    return { order, signature, orderHash };
  }

  private async offerERC20ForERC1155(
    erc1155Address: string,
    erc1155Id: BigNumber,
    erc1155BuyAmount: BigNumber,
    erc1155BuyDenominator: BigNumber,
    erc20Address: string,
    erc20BuyPrice: BigNumber,
    expirationTime: number
  ): Promise<{ order: Order; signature: Sig; orderHash: string }> {
    const maker = await this.signer.getAddress();

    // static extradata for both the order and counter order are checked during the StaticMarket calls
    const staticExtradata = ethers.utils.defaultAbiCoder.encode(
      ["address[2]", "uint256[3]"],
      [
        [erc20Address, erc1155Address],
        [erc1155Id, erc20BuyPrice, erc1155BuyDenominator],
      ]
    );
    const order = {
      registry: this.addresses.WyvernRegistry,
      maker,
      staticTarget: this.addresses.StaticMarket,
      staticSelector: anyERC20ForERC1155Selector,
      staticExtradata,
      maximumFill: BigNumber.from(erc20BuyPrice)
        .mul(BigNumber.from(erc1155BuyAmount))
        .toString(),
      listingTime: await this.getBlockTimestamp(),
      expirationTime,
      salt: this.generateSalt(),
    };

    const signature = await this.sign(order); // calls out to the signer (wallet, often Metamask)
    const orderHash = await this.getOrderHash(order);

    return { order, signature, orderHash };
  }

  private async matchERC1155ForERC20(
    sellOrder: Order,
    sellSig: Sig,
    buyOrder: Order,
    buySig: Sig,
    buyAmount: BigNumber
  ): Promise<Transaction> {
    const [
      [erc1155Address, erc20Address],
      [tokenId, erc1155Numerator, erc20SellPrice],
    ] = ethers.utils.defaultAbiCoder.decode(
      ["address[2]", "uint256[3]"],
      sellOrder.staticExtradata
    );
    const [
      [erc20AddressOther, erc1155AddressOther],
      [tokenIdOther, erc20BuyPrice, erc1155Denominator],
    ] = ethers.utils.defaultAbiCoder.decode(
      ["address[2]", "uint256[3]"],
      buyOrder.staticExtradata
    );

    // these checks are also performed within the static calls on StaticMarket, but we check here before going on chain
    if (erc1155Address != erc1155AddressOther)
      throw new Error("ERC1155 Addresses don't match on orders");
    if (erc20Address != erc20AddressOther)
      throw new Error("ERC20 Addresses don't match on orders");
    if (!tokenId.eq(tokenIdOther))
      throw new Error("ERC1155 token IDs don't match on orders");
    if (!erc20SellPrice.eq(erc20BuyPrice))
      throw new Error("ERC20 buying prices don't match on orders");
    if (!erc1155Numerator.eq(erc1155Denominator))
      throw new Error("ERC1155 Numerator and Denominator don't match");

    const firstData =
      ERC1155Interface.encodeFunctionData("safeTransferFrom", [
        sellOrder.maker,
        buyOrder.maker,
        tokenId,
        buyAmount,
        "0x",
      ]) + ZERO_BYTES32.substr(2);
    const secondData = ERC20Interface.encodeFunctionData("transferFrom", [
      buyOrder.maker,
      sellOrder.maker,
      buyOrder.maximumFill,
    ]);

    const firstCall = { target: erc1155Address, howToCall: 0, data: firstData };
    const secondCall = { target: erc20Address, howToCall: 0, data: secondData };

    return await this.atomicMatch(
      sellOrder,
      sellSig,
      firstCall,
      buyOrder,
      buySig,
      secondCall,
      ZERO_BYTES32
    );
  }

  private async offerLazyERC1155ForERC20(
    erc1155Address: string,
    erc1155Id: BigNumber,
    erc1155SellAmount: BigNumber,
    erc1155SellNumerator: BigNumber,
    erc20Address: string,
    erc20SellPrice: BigNumber,
    expirationTime: number,
    extraBytes: string
  ): Promise<{ order: Order; signature: Sig; orderHash: string }> {
    const maker = await this.signer.getAddress();
    const staticExtradata = ethers.utils.defaultAbiCoder.encode(
      ["address[2]", "uint256[3]", "bytes"],
      [
        [erc1155Address, erc20Address],
        [erc1155Id, erc1155SellNumerator, erc20SellPrice],
        extraBytes,
      ]
    );
    const order = {
      registry: this.addresses.WyvernRegistry,
      maker,
      staticTarget: this.addresses.StaticMarket,
      staticSelector: LazyERC1155ForERC20Selector,
      staticExtradata,
      maximumFill: BigNumber.from(erc1155SellNumerator)
        .mul(BigNumber.from(erc1155SellAmount))
        .toString(),
      listingTime: await this.getBlockTimestamp(),
      expirationTime: expirationTime,
      salt: this.generateSalt(),
    };

    const signature = await this.sign(order); // calls out to the signer (wallet, often Metamask)
    const orderHash = await this.getOrderHash(order);

    return { order, signature, orderHash };
  }

  private async offerERC20ForLazyERC1155(
    erc1155Address: string,
    erc1155Id: BigNumber,
    erc1155BuyAmount: BigNumber,
    erc1155BuyDenominator: BigNumber,
    erc20Address: string,
    erc20BuyPrice: BigNumber,
    expirationTime: number,
    extraBytes: string
  ): Promise<{ order: Order; signature: Sig; orderHash: string }> {
    const maker = await this.signer.getAddress();
    const staticExtradata = ethers.utils.defaultAbiCoder.encode(
      ["address[2]", "uint256[3]", "bytes"],
      [
        [erc20Address, erc1155Address],
        [erc1155Id, erc20BuyPrice, erc1155BuyDenominator],
        extraBytes,
      ]
    );
    const order = {
      registry: this.addresses.WyvernRegistry,
      maker,
      staticTarget: this.addresses.StaticMarket,
      staticSelector: LazyERC20ForERC1155Selector,
      staticExtradata,
      maximumFill: BigNumber.from(erc20BuyPrice)
        .mul(BigNumber.from(erc1155BuyAmount))
        .toString(),
      listingTime: await this.getBlockTimestamp(),
      expirationTime,
      salt: this.generateSalt(),
    };

    const signature = await this.sign(order); // calls out to the signer (wallet, often Metamask)
    const orderHash = await this.getOrderHash(order);

    return { order, signature, orderHash };
  }

  private async matchLazy1155ForERC20(
    sellOrder: Order,
    sellSig: Sig,
    buyOrder: Order,
    buySig: Sig,
    buyAmount: BigNumber
  ): Promise<Transaction> {
    const [
      [erc1155Address, erc20Address],
      [tokenId, erc1155Numerator, erc20SellPrice],
      tokenURI,
    ] = ethers.utils.defaultAbiCoder.decode(
      ["address[2]", "uint256[3]", "bytes"],
      sellOrder.staticExtradata
    );
    const [
      [erc20AddressOther, erc1155AddressOther],
      [tokenIdOther, erc20BuyPrice, erc1155Denominator],
      tokenURIOther,
    ] = ethers.utils.defaultAbiCoder.decode(
      ["address[2]", "uint256[3]", "bytes"],
      buyOrder.staticExtradata
    );

    if (erc1155Address != erc1155AddressOther)
      throw new Error("ERC1155 Addresses don't match on orders");
    if (erc20Address != erc20AddressOther)
      throw new Error("ERC20 Addresses don't match on orders");
    if (!tokenId.eq(tokenIdOther))
      throw new Error("ERC1155 token IDs don't match on orders");
    if (!erc20SellPrice.eq(erc20BuyPrice))
      throw new Error("ERC20 buying prices don't match on orders");
    if (!erc1155Numerator.eq(erc1155Denominator))
      throw new Error("ERC1155 Numerator and Denominator don't match");
    if (tokenURI != tokenURIOther)
      throw new Error("Lazy mint tokenURIs don't match on orders");

    const firstData = ERC1155Interface.encodeFunctionData(
      "mint(address,uint256,uint256,bytes)",
      [buyOrder.maker, tokenId, buyAmount, tokenURI]
    );
    const secondData = ERC20Interface.encodeFunctionData("transferFrom", [
      buyOrder.maker,
      sellOrder.maker,
      buyOrder.maximumFill,
    ]);

    const firstCall = { target: erc1155Address, howToCall: 0, data: firstData };
    const secondCall = { target: erc20Address, howToCall: 0, data: secondData };

    return await this.atomicMatch(
      sellOrder,
      sellSig,
      firstCall,
      buyOrder,
      buySig,
      secondCall,
      ZERO_BYTES32
    );
  }

  private async offerERC20ForERC20(
    erc20SellerAddress: string,
    sellingPrice: BigNumber,
    sellAmount: BigNumber,
    erc20BuyerAddress: string,
    buyingPrice: BigNumber,
    expirationTime: number
  ): Promise<{ order: Order; signature: Sig }> {
    const maker = await this.signer.getAddress();
    const staticExtradata = ethers.utils.defaultAbiCoder.encode(
      ["address[2]", "uint256[2]"],
      [
        [erc20SellerAddress, erc20BuyerAddress],
        [sellingPrice, buyingPrice],
      ]
    );

    const order = {
      registry: this.addresses.WyvernRegistry,
      maker,
      staticTarget: this.addresses.StaticMarket,
      staticSelector: anyERC20ForERC20Selector,
      staticExtradata,
      maximumFill: sellAmount.toString(),
      listingTime: await this.getBlockTimestamp(),
      expirationTime,
      salt: this.generateSalt(),
    };

    const signature = await this.sign(order);

    return { order, signature };
  }

  private async matchERC20ForERC20(
    sellOrder: Order,
    sellSig: Sig,
    buyOrder: Order,
    buySig: Sig,
    buyAmount: BigNumber
  ): Promise<Transaction> {
    const [
      [erc20SellerAddress, erc20BuyerAddress],
      [sellingPrice, buyingPrice],
    ] = ethers.utils.defaultAbiCoder.decode(
      ["address[2]", "uint256[2]"],
      sellOrder.staticExtradata
    );
    const [
      [erc20BuyerAddressOther, erc20SellerAddressOther],
      [buyingPriceOther, sellingPriceOther],
    ] = ethers.utils.defaultAbiCoder.decode(
      ["address[2]", "uint256[2]"],
      buyOrder.staticExtradata
    );

    if (erc20SellerAddress != erc20SellerAddressOther)
      throw new Error("ERC20 Addresses don't match on orders");
    if (erc20BuyerAddress != erc20BuyerAddressOther)
      throw new Error("ERC20 Addresses don't match on orders");
    if (!sellingPrice.eq(sellingPriceOther))
      throw new Error("ERC20 selling prices don't match on orders");
    if (!buyingPrice.eq(buyingPriceOther))
      throw new Error("ERC20 buying prices don't match on orders");

    const firstData = ERC20Interface.encodeFunctionData("transferFrom", [
      sellOrder.maker,
      buyOrder.maker,
      buyAmount,
    ]);
    const secondData = ERC20Interface.encodeFunctionData("transferFrom", [
      buyOrder.maker,
      sellOrder.maker,
      BigNumber.from(buyAmount).mul(BigNumber.from(sellingPrice)),
    ]);

    const firstCall = {
      target: erc20SellerAddress,
      howToCall: 0,
      data: firstData,
    };
    const secondCall = {
      target: erc20BuyerAddress,
      howToCall: 0,
      data: secondData,
    };

    return await this.atomicMatch(
      sellOrder,
      sellSig,
      firstCall,
      buyOrder,
      buySig,
      secondCall,
      ZERO_BYTES32
    );
  }

  /**
   * Generates the order and signature by prompting the signer
   * @param tokenType enum ERC721 | LazyERC721 | ERC1155 | LazyERC155
   * @param tokenAddress NFT contract address
   * @param tokenId NFT id
   * @param erc20Address ERC20 contract address
   * @param erc20BuyPrice ERC20 bid amount in Wei (fully expanded decimals)
   * @param expirationTime Unix timestamp in seconds
   * @param optionalParams ERC1155 bids require a buy amount and buy denominator, and lazy bids require an extraBytes string
   * @returns order struct, signed order, and the order hash
   */
  public async placeBid(
    tokenType: string,
    tokenAddress: string,
    tokenId: BigNumber,
    erc20Address: string,
    erc20BuyPrice: BigNumber,
    expirationTime: number,
    optionalParams?: {
      erc1155BuyAmount?: BigNumber;
      erc1155BuyDenominator?: BigNumber;
      extraBytes?: string;
    }
  ): Promise<{ order: Order; signature: Sig; orderHash: string }> {
    switch (tokenType) {
      case "ERC721":
        return this.offerERC20ForERC721(
          tokenAddress,
          tokenId,
          erc20Address,
          erc20BuyPrice,
          expirationTime
        );
      case "LazyERC721":
        if (!optionalParams)
          throw new Error("No optional params for lazy ERC721");
        if (!optionalParams.extraBytes)
          throw new Error("Must include param extraBytes for lazy mint");
        return this.offerERC20ForLazyERC721(
          tokenAddress,
          tokenId,
          erc20Address,
          erc20BuyPrice,
          expirationTime,
          optionalParams.extraBytes
        );
      case "ERC1155":
        if (!optionalParams) throw new Error("No optional params for ERC1155");
        if (!optionalParams.erc1155BuyAmount)
          throw new Error(
            "Must include param erc1155BuyAmount for ERC1155 Bid"
          );
        if (!optionalParams.erc1155BuyDenominator)
          throw new Error(
            "Must include param erc1155BuyDenominator for ERC1155 Bid"
          );
        return this.offerERC20ForERC1155(
          tokenAddress,
          tokenId,
          optionalParams.erc1155BuyAmount,
          optionalParams.erc1155BuyDenominator,
          erc20Address,
          erc20BuyPrice,
          expirationTime
        );
      case "LazyERC1155":
        if (!optionalParams) throw new Error("No optional params for ERC1155");
        if (!optionalParams.erc1155BuyAmount)
          throw new Error(
            "Must include param erc1155BuyAmount for ERC1155 Bid"
          );
        if (!optionalParams.erc1155BuyDenominator)
          throw new Error(
            "Must include param erc1155BuyDenominator for ERC1155 Bid"
          );
        if (!optionalParams.extraBytes)
          throw new Error("Must include param extraBytes for lazy mint");
        return this.offerERC20ForLazyERC1155(
          tokenAddress,
          tokenId,
          optionalParams.erc1155BuyAmount,
          optionalParams.erc1155BuyDenominator,
          erc20Address,
          erc20BuyPrice,
          expirationTime,
          optionalParams.extraBytes
        );
      default:
        throw Error(
          "Wrong token type. Must be ERC721, LazyERC721, ERC1155, or LazyERC1155"
        );
    }
  }

  /**
   * Generates the order and signature by prompting the signer
   * @param tokenType enum ERC721 | LazyERC721 | ERC1155 | LazyERC155
   * @param tokenAddress NFT contract address
   * @param tokenId NFT id
   * @param erc20Address ERC20 contract address
   * @param erc20SellPrice ERC20 bid amount in Wei (fully expanded decimals)
   * @param expirationTime Unix timestamp in seconds
   * @param optionalParams ERC1155 asks require a sell amount and buy numerator, and lazy asks require an extraBytes string
   * @returns order struct, signed order, and the order hash
   */
  public async placeAsk(
    tokenType: string,
    tokenAddress: string,
    tokenId: BigNumber,
    erc20Address: string,
    erc20SellPrice: BigNumber,
    expirationTime: number,
    optionalParams?: {
      erc1155SellAmount?: BigNumber;
      erc1155SellNumerator?: BigNumber;
      extraBytes?: string;
    }
  ): Promise<{ order: Order; signature: Sig; orderHash: string }> {
    switch (tokenType) {
      case "ERC721":
        return this.offerERC721ForERC20(
          tokenAddress,
          tokenId,
          erc20Address,
          erc20SellPrice,
          expirationTime
        );
      case "LazyERC721":
        if (!optionalParams.extraBytes)
          throw new Error("Must include param extraBytes for lazy mint");
        return this.offerLazyERC721ForERC20(
          tokenAddress,
          tokenId,
          erc20Address,
          erc20SellPrice,
          expirationTime,
          optionalParams.extraBytes
        );
      case "ERC1155":
        if (!optionalParams.erc1155SellAmount)
          throw new Error(
            "Must include param erc1155SellAmount for ERC1155 Ask"
          );
        if (!optionalParams.erc1155SellNumerator)
          throw new Error(
            "Must include param erc1155SellNumerator for ERC1155 Ask"
          );
        return this.offerERC1155ForERC20(
          tokenAddress,
          tokenId,
          optionalParams.erc1155SellAmount,
          optionalParams.erc1155SellNumerator,
          erc20Address,
          erc20SellPrice,
          expirationTime
        );
      case "LazyERC1155":
        if (!optionalParams.erc1155SellAmount)
          throw new Error(
            "Must include param erc1155SellAmount for ERC1155 Ask"
          );
        if (!optionalParams.erc1155SellNumerator)
          throw new Error(
            "Must include param erc1155SellNumerator for ERC1155 Ask"
          );
        if (!optionalParams.extraBytes)
          throw new Error("Must include param extraBytes for lazy mint");
        return this.offerLazyERC1155ForERC20(
          tokenAddress,
          tokenId,
          optionalParams.erc1155SellAmount,
          optionalParams.erc1155SellNumerator,
          erc20Address,
          erc20SellPrice,
          expirationTime,
          optionalParams.extraBytes
        );
      default:
        throw Error("Wrong token type. Must be ERC721 or ERC1155");
    }
  }

  /**
   * If compatible, matches the two orders on chain and exchanges the tokens
   * @param tokenType enum ERC721 | LazyERC721 | ERC1155 | LazyERC155
   * @param sellOrder order struct for the NFT (sell side)
   * @param sellSig the signed sellOrder
   * @param buyOrder order struct for the ERC20 (buy side)
   * @param buySig the signed buyOrder
   * @param buyAmount if 1155 token, the amount of tokens being bought
   * @returns transaction details
   */
  public async matchOrders(
    tokenType: string,
    sellOrder: Order,
    sellSig: Sig,
    buyOrder: Order,
    buySig: Sig,
    buyAmount?: BigNumber
  ): Promise<Transaction> {
    switch (tokenType) {
      case "ERC721":
        return this.matchERC721ForERC20(sellOrder, sellSig, buyOrder, buySig);
      case "LazyERC721":
        return this.matchLazy721ForERC20(sellOrder, sellSig, buyOrder, buySig);
      case "ERC1155":
        return this.matchERC1155ForERC20(
          sellOrder,
          sellSig,
          buyOrder,
          buySig,
          buyAmount
        );
      case "LazyERC1155":
        return this.matchLazy1155ForERC20(
          sellOrder,
          sellSig,
          buyOrder,
          buySig,
          buyAmount
        );
      default:
        throw Error("Wrong token type. Must be ERC721 or ERC1155");
    }
  }

  /**
   * Clears an order on chain so that it cannot be reused. Not necessary, but safe.
   * @param order order struct (buy or sell)
   * @returns transaction details
   */
  public async cancelOrder(order: Order): Promise<Transaction> {
    const orderHash = await this.getOrderHash(order);
    const tx = await this.exchange.setOrderFill_(orderHash, order.maximumFill);
    tx.wait();
    return tx;
  }

  // utility chain calls for the frontend
  public async getOrRegisterProxy(): Promise<OwnableDelegateProxy> {
    const proxy = await this.registry.proxies(await this.signer.getAddress());
    if (proxy !== ZERO_ADDRESS) {
      return OwnableDelegateProxy__factory.connect(proxy, this.signer);
    }
    const tx = await this.registry.registerProxy();
    await tx.wait();
    return this.getOrRegisterProxy();
  }

  public async getOrIncreaseApproval(
    tokenType: string,
    tokenAddress: string,
    amount?: BigNumber
  ): Promise<boolean | BigNumber> {
    const proxy = await this.registry.proxies(await this.signer.getAddress());
    if (proxy === ZERO_ADDRESS)
      throw new Error("Signer does not have a proxy registered");

    switch (tokenType) {
      case tokenTypes.ERC20: {
        const contract = ERC20__factory.connect(tokenAddress, this.signer);
        const allowance = await contract.allowance(
          await this.signer.getAddress(),
          proxy
        );
        if ((amount && allowance.gt(amount)) || allowance.gt(zero))
          return allowance;
        const tx = await contract.approve(proxy, amount);
        await tx.wait();
        return this.getOrIncreaseApproval(tokenType, tokenAddress, amount);
      }
      case tokenTypes.ERC721: {
        const contract = ERC721__factory.connect(tokenAddress, this.signer);
        const approval = await contract.isApprovedForAll(
          await this.signer.getAddress(),
          proxy
        );
        if (approval) return approval;
        const tx = await contract.setApprovalForAll(proxy, true);
        await tx.wait();
        return this.getOrIncreaseApproval(tokenType, tokenAddress);
      }
      case tokenTypes.ERC1155: {
        const contract = ERC1155__factory.connect(tokenAddress, this.signer);
        const approval = await contract.isApprovedForAll(
          await this.signer.getAddress(),
          proxy
        );
        if (approval) return approval;
        const tx = await contract.setApprovalForAll(proxy, true);
        await tx.wait();
        return this.getOrIncreaseApproval(tokenType, tokenAddress);
      }
      default:
        throw new Error(
          "This method only works for ERC20, 721, or 1155 tokens"
        );
    }
  }
}
