import { ethers, Signer } from 'ethers';
import { Interface } from "ethers/lib/utils";
import StaticMarketABI from "../build/abis/StaticMarket.json"
import ERC20ABI from "../build/abis/ERC20.json"
import ERC721ABI from "../build/abis/ERC721.json"
import ERC1155ABI from "../build/abis/ERC1155.json"
import {
  ZERO_BYTES32,
  eip712Order,
  anyERC1155ForERC20Selector,
  anyERC20ForERC1155Selector,
  ERC721ForERC20Selector,
  ERC20ForERC721Selector,
} from './constants';
import { 
  WyvernExchange,
  WyvernExchange__factory,
} from '../build/types';

let ERC20Interface = new Interface(ERC20ABI);
let ERC721Interface = new Interface(ERC721ABI);
let ERC1155Interface = new Interface(ERC1155ABI);

export type WyvernSystem = {
  WyvernRegistry: string;
  WyvernExchange: string;
  StaticMarket: string;
}

export type Order = {
  registry: string;
  maker: string;
  staticTarget: string;
  staticSelector: string;
  staticExtradata: string;
  maximumFill: number;
  listingTime: string;
  expirationTime: string;
  salt: string;
}

export type Sig = {
  v: number;
  r: string;
  s: string;
}

export type Call = {
  target: string;
  howToCall: number;
  data: string
}


export const addressesByChainId = {
  1: {
    WyvernRegistry: "0xa5409ec958C83C3f309868babACA7c86DCB077c1",
    WyvernExchange: "0xd7CA74fF003c90E62505D21ec7Dac36bCfD9F6f2",
    StaticMarket: "",
  },
  4: {
    WyvernRegistry: "0x30caa00562AD2f2B41BB4b1943d28F84832ce0D6",
    WyvernExchange: "0xF40D3F036528Ed87b83748306c719757f22be4fE",
    StaticMarket: "",
  },
  1337: {
    WyvernRegistry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    WyvernExchange: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    StaticMarket: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  },
}

export class WrappedExchange {
  public exchange: WyvernExchange;
  public addresses: WyvernSystem;
  public signer: any; // Signer;
  public chainId: number;
  public EIP712Domain: any;
  
  constructor(signer: Signer, chainId: number) {
    this.signer = signer;
    this.addresses = addressesByChainId[chainId]
    this.exchange = WyvernExchange__factory.connect(this.addresses.WyvernExchange, signer);
    this.EIP712Domain ={ name: 'Wyvern Exchange', version: '3.1', chainId, verifyingContract: this.exchange.address }
  }

  private parseSig(bytes) {
    bytes = bytes.substr(2);
    const r = '0x' + bytes.slice(0, 64);
    const s = '0x' + bytes.slice(64, 128);
    const v = parseInt('0x' + bytes.slice(128, 130), 16);
    return { v, r, s }
  }

  private async sign(order: Order) {
    // see https://docs.ethers.io/v5/api/signer/#Signer-signTypedData
    return this.signer._signTypedData(
      this.EIP712Domain,
      { Order: eip712Order.fields },
      order
    ).then(sigBytes => {
      const sig = this.parseSig(sigBytes)
      return sig
    })
  }

  private async atomicMatch(order: Order, sig: Sig, call: Call, counterorder: Order, countersig: Sig, countercall: Call, metadata) {
    return await this.exchange.atomicMatch_(
      [order.registry, order.maker, order.staticTarget, order.maximumFill, order.listingTime, order.expirationTime, order.salt, call.target,
        counterorder.registry, counterorder.maker, counterorder.staticTarget, counterorder.maximumFill, counterorder.listingTime, counterorder.expirationTime, counterorder.salt, countercall.target],
      [order.staticSelector, counterorder.staticSelector],
      order.staticExtradata, call.data, counterorder.staticExtradata, countercall.data,
      [call.howToCall, countercall.howToCall],
      metadata,
      ethers.utils.defaultAbiCoder.encode(['bytes', 'bytes'], [
        ethers.utils.defaultAbiCoder.encode(['uint8', 'bytes32', 'bytes32'], [sig.v, sig.r, sig.s]),
        ethers.utils.defaultAbiCoder.encode(['uint8', 'bytes32', 'bytes32'], [countersig.v, countersig.r, countersig.s])
      ])
    )
  }

  public async offerERC721ForERC20 (erc721Address: string, erc721Id, erc20Address: string, erc20SellPrice, expirationTime: string) {
    const maker = await this.signer.getAddress();
    const staticExtradata = ethers.utils.defaultAbiCoder.encode(
      ['address[2]', 'uint256[2]'],
      [
        [erc721Address, erc20Address],
        [erc721Id, erc20SellPrice]
      ]
    );
    const sellOffer = {
      registry: this.addresses.WyvernRegistry,
      maker,
      staticTarget: this.addresses.StaticMarket,
      staticSelector: ERC721ForERC20Selector,
      staticExtradata,
      maximumFill: 1,
      listingTime: '0',
      expirationTime,
      salt: '11'
    }

    const sellSig = await this.sign(sellOffer)

    return {
      offer: sellOffer,
      signature: sellSig
    }
  }
  
  public async offerERC20ForERC721 (erc721Address: string, erc721Id, erc20Address: string, erc20BuyPrice, expirationTime: string) {
    const maker = await this.signer.getAddress();
    const staticExtradata = ethers.utils.defaultAbiCoder.encode(
      ['address[2]', 'uint256[2]'],
      [
        [erc20Address, erc721Address],
        [erc721Id, erc20BuyPrice]
      ]
    )
    const buyOffer = {
      registry: this.addresses.WyvernRegistry,
      maker,
      staticTarget: this.addresses.StaticMarket,
      staticSelector: ERC20ForERC721Selector,
      staticExtradata,
      maximumFill: erc20BuyPrice,
      listingTime: '0',
      expirationTime: expirationTime,
      salt: '12'
    }

    const buySig = await this.sign(buyOffer)

    return {
      offer: buyOffer,
      signature: buySig,
    }
  }
  
  public async matchERC721ForERC20 (sellOrder: Order, sellSig: Sig, buyOrder: Order, buySig: Sig) {
    const [[erc721Address, erc20Address], [tokenId, buyingPrice]] = ethers.utils.defaultAbiCoder.decode(['address[2]', 'uint256[2]'], sellOrder.staticExtradata)
    const [[erc20AddressOther, erc721AddressOther], [tokenIdOther, buyingPriceOther]] = ethers.utils.defaultAbiCoder.decode(['address[2]', 'uint256[2]'], buyOrder.staticExtradata)
    
    if (erc721Address != erc721AddressOther) throw new Error('ERC721 Addresses don\'t match on orders')
    if (erc20Address != erc20AddressOther) throw new Error('ERC20 Addresses don\'t match on orders')
    if (!tokenId.eq(tokenIdOther)) throw new Error('ERC721 token IDs don\'t match on orders')
    if (!buyingPrice.eq(buyingPriceOther)) throw new Error('ERC20 buying prices don\'t match on orders')

    const firstData = ERC721Interface.encodeFunctionData("transferFrom", [sellOrder.maker, buyOrder.maker, tokenId]) // this might be weird bc passing in BigNumbers...
    const secondData = ERC20Interface.encodeFunctionData("transferFrom", [buyOrder.maker, sellOrder.maker, buyingPrice])
    
    const firstCall = {target: erc721Address, howToCall: 0, data: firstData}
    const secondCall = {target: erc20Address, howToCall: 0, data: secondData}

    await this.atomicMatch(sellOrder, sellSig, firstCall, buyOrder, buySig, secondCall, ZERO_BYTES32)
  }
}

// export const offerERC1155ForERC20 = async (signer, tokenId, sellingNumber = 1, sellingPrice) => {
//   const selectorOne = marketStaticInterface.getSighash('anyERC1155ForERC20(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
//   const paramsOne = coder.encode(
//     ['address[2]', 'uint256[3]'],
//     [[erc1155.address, erc20.address], [tokenId, sellingNumber, sellingPrice]]
//   )
//   const order = {
//     registry: registry.address,
//     maker: signer.address,
//     staticTarget: staticMarket.address,
//     staticSelector: selectorOne,
//     staticExtradata: paramsOne,
//     maximumFill: sellingNumber * sellingPrice,
//     listingTime: '0',
//     expirationTime: '10000000000',
//     salt: '11'
//   }
//   let sigOne = await wrappedExchange.sign(order, signer);
// }

// export const offerERC20ForERC1155 = async (signer) => {
//   const selectorTwo = marketStaticInterface.getSighash('anyERC20ForERC1155(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
//   const paramsTwo = coder.encode(
//     ['address[2]', 'uint256[3]'],
//     [[erc20.address, erc1155.address], [buyTokenId || tokenId, buyingPrice, buyingDenominator || 1]]
//     )
//   const order = {
//     registry: registry.address,
//     maker: signer.address,
//     staticTarget: staticMarket.address,
//     staticSelector: selectorTwo,
//     staticExtradata: paramsTwo,
//     maximumFill: buyingPrice*buyAmount,
//     listingTime: '0',
//     expirationTime: '10000000000',
//     salt: '12'
//   }
//   const sig = await wrappedExchange.sign(order, signer);
//   return sig
// }

// export const matchERC1155andERC20 = async (sellOrder, sellSig, buyOrder, buySig) => {
//   const firstData = ERC1155Interface.encodeFunctionData("safeTransferFrom", [sellOrder.maker, buyOrder.maker, tokenId, sellingNumerator || buyAmount, "0x"]) + ZERO_BYTES32.substr(2)
//   const secondData = ERC20Interface.encodeFunctionData("transferFrom", [buyOrder.maker, sellOrder.maker, buyAmount*buyingPrice]);
  
//   const firstCall = {target: erc1155.address, howToCall: 0, data: firstData}
//   const secondCall = {target: erc20.address, howToCall: 0, data: secondData}
//   await wrappedExchange.atomicMatchWith(sellOrder, sellSig, firstCall, buyOrder, buySig, secondCall, ZERO_BYTES32, {from: sender || account_a});
// }

