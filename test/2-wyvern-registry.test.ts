import { expect, assert} from 'chai';
import { ethers } from 'hardhat';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';

import { 
  WyvernRegistry__factory, 
  WyvernRegistry,
  AuthenticatedProxy__factory,
  AuthenticatedProxy,
  OwnableDelegateProxy__factory,
  OwnableDelegateProxy,
  TestAuthenticatedProxy__factory,
  TestAuthenticatedProxy,
  TestERC20__factory,
  TestERC20
} from '../build/types';

import { increaseTime } from './auxiliary';

describe('WyvernRegistry', () => {

  let registry: WyvernRegistry;
  let signers;

  beforeEach(async () => {

    signers = await ethers.getSigners();
    const wyvernRegistryFactory = (await ethers.getContractFactory('WyvernRegistry', signers[0])) as WyvernRegistry__factory;
    registry = await wyvernRegistryFactory.deploy();
    await registry.deployed();
    await registry.grantInitialAuthentication(registry.address);
  })

  it('does not allow additional grant',async () => {
    return expect(
      registry.grantInitialAuthentication(registry.address)
      ).to.revertedWith('Wyvern Protocol Proxy Registry initial address already set');
  })

  it('has a delegateproxyimpl', async () => {
    let delegateproxyimpl = await registry.delegateProxyImplementation();
    assert.equal(delegateproxyimpl.length,42,'delegateproxyimpl was not set');
  })

  it('allows proxy registration', async () => {
    await registry.connect(signers[3]).registerProxy();
    let proxy = await registry.proxies(signers[3].address);
    assert.ok(proxy.length > 0);
  })

  it('allows proxy registration',async () => {
    await registry.connect(signers[2]).registerProxy();
    let proxy = await registry.proxies(signers[2].address);
    assert.ok(proxy.length > 0)
  })

  it('allows proxy override', async () => {
    await registry.connect(signers[2]).registerProxyOverride();
    let proxy = await registry.proxies(signers[2].address);
    assert.isTrue(proxy.length > 0);
  })

  it('allows proxy upgrade', async () => {
    await registry.connect(signers[5]).registerProxy();
    let proxy = await registry.proxies(signers[5].address);
    let contract = await ethers.getContractAt('OwnableDelegateProxy', proxy);
    let implementation = await registry.delegateProxyImplementation();
    assert.isOk(await contract.connect(signers[5]).upgradeTo(registry.address));
    assert.isOk(await contract.connect(signers[5]).upgradeTo(implementation));
  })

  it('allows proxy to receive ether',async () => {
    await registry.connect(signers[5]).registerProxy();
    let proxy = await registry.proxies(signers[5].address);
    assert.isOk(await signers[0].sendTransaction({to: proxy, value: 1000}));
  })

  it('allows proxy to receive tokens before approval',async () => {
    const amount = '1000';
    await registry.connect(signers[3]).registerProxy();
    let proxy = await registry.proxies(signers[3].address);
    const testERC20Factory = (await ethers.getContractFactory('TestERC20', signers[0])) as TestERC20__factory;
    let erc20 = await testERC20Factory.deploy();
    await erc20.deployed();
    let contract = await ethers.getContractAt('AuthenticatedProxy', proxy);
    return expect(
      contract.connect(signers[3]).receiveApproval(signers[3].address,amount, erc20.address,'0x')
    ).to.be.revertedWith('ERC20: transfer amount exceeds balance')
  })

  it('allows proxy to receive tokens',async () => {
    const amount = '1000';
    await registry.connect(signers[3]).registerProxy();
    let proxy = await registry.proxies(signers[3].address);
    const testERC20Factory = (await ethers.getContractFactory('TestERC20', signers[0])) as TestERC20__factory;
    let erc20 = await testERC20Factory.deploy();
    await erc20.deployed();
    await Promise.all([erc20.mint(signers[3].address,amount), erc20.connect(signers[3]).approve(proxy, amount)]);
    let contract = await ethers.getContractAt('AuthenticatedProxy', proxy);
    assert.isOk(contract.connect(signers[3]).receiveApproval(signers[3].address,amount,erc20.address,'0x'))
  })

  it('does not allow proxy upgrade to same implementation',async () => {
    await registry.connect(signers[3]).registerProxy();
    let proxy = await registry.proxies(signers[3].address);
    let implementation = await registry.delegateProxyImplementation();
    let contract = await ethers.getContractAt('OwnableDelegateProxy', proxy);
    return expect(
      contract.connect(signers[3]).upgradeTo(implementation)
    ).to.be.revertedWith('Proxy already uses this implementation')
  })

  it('returns proxy type',async () => {
    await registry.connect(signers[3]).registerProxy();
    let proxy = await registry.proxies(signers[3].address);
    let contract = (await ethers.getContractAt('OwnableDelegateProxy', proxy)) as OwnableDelegateProxy;
    let proxyType = await contract.proxyType();
    assert.equal(proxyType.toNumber(), 2,'Incorrect proxy type')
  })

  it('does not allow proxy update from another account',async () => {
    await registry.connect(signers[3]).registerProxy();
    let proxy = await registry.proxies(signers[3].address);
    let contract = (await ethers.getContractAt('OwnableDelegateProxy', proxy)) as OwnableDelegateProxy;
    return expect(contract.connect(signers[1]).upgradeTo(registry.address)
    ).to.be.revertedWith('Only the proxy owner can call this method')
  })

  it('allows proxy ownership transfer',async () => {
    await registry.connect(signers[3]).registerProxy();
    let proxy = await registry.proxies(signers[3].address);
    let contract = await ethers.getContractAt('OwnableDelegateProxy', proxy);
    assert.isOk(await contract.connect(signers[3]).transferProxyOwnership(signers[4].address));
    assert.isOk(await contract.connect(signers[4]).transferProxyOwnership(signers[3].address));
  })

  it('allows start but not end of authentication process',async () => {
    await registry.startGrantAuthentication(signers[0].address)
    let timestamp = await registry.pending(signers[0].address)
    assert.isTrue(timestamp.toNumber() > 0,'Invalid timestamp')
    return expect(
      registry.endGrantAuthentication(signers[0].address)
    ).to.be.revertedWith('Contract is no longer pending or has already been approved by registry')
  })

  it('does not allow start twice',async () => {
    await registry.startGrantAuthentication(signers[0].address)
    return expect(
      registry.startGrantAuthentication(signers[0].address)
    ).to.be.revertedWith('Contract is already allowed in registry, or pending')
  })

  it('does not allow end without start',async () => {
    return expect(
      registry.endGrantAuthentication(signers[1].address)
    ).to.be.revertedWith('Contract is no longer pending or has already been approved by registry')
  })

  it('allows end after time has passed',async () => {
    await registry.startGrantAuthentication(signers[0].address)
    await increaseTime(86400 * 7 * 3);
    await registry.endGrantAuthentication(signers[0].address);
    let result = await registry.contracts(signers[0].address);
    assert.isTrue(result,'Auth was not granted');
    await registry.revokeAuthentication(signers[0].address);
    result = await registry.contracts(signers[0].address);
    assert.isFalse(result,'Auth was not revoked');
  })

  it('allows proxy registration for another user',async () => {
    await registry.registerProxyFor(signers[1].address);
    let proxy = await registry.proxies(signers[1].address);
    assert.isTrue(proxy.length > 0)
  })

  it('does not allow proxy registration for another user if a proxy already exists', async () => {
    await registry.registerProxyFor(signers[1].address)
    return expect(
      registry.registerProxyFor(signers[1].address)
    ).to.be.revertedWith('User already has a proxy')
  })

  it('does not allow proxy transfer from another account',async () => {
    let proxy = await registry.proxies(signers[2].address);
    return expect(
      registry.transferAccessTo(proxy, signers[2].address)
    ).to.be.revertedWith('Proxy transfer can only be called by the proxy')
  })

  it('allows proxy revocation',async () => {
    const testAuthenticatedProxyFactory = (await ethers.getContractFactory('TestAuthenticatedProxy', signers[0])) as TestAuthenticatedProxy__factory;
    let testProxy = await testAuthenticatedProxyFactory.deploy();
    await testProxy.deployed();
    await registry.connect(signers[1]).registerProxy();
    let proxy = await registry.proxies(signers[1].address);
    let contract = await ethers.getContractAt('AuthenticatedProxy', proxy);
    let user = await contract.user();
    assert.equal(user, signers[1].address)
    await contract.connect(signers[1]).setRevoke(true);
    assert.isTrue(await contract.revoked(),'Should be revoked')
    assert.isOk(await contract.connect(signers[1]).setRevoke(false),'Should be unrevoked')
  })

  it('does not allow revoke from another account',async () => {
    await registry.connect(signers[3]).registerProxy();
    let proxy = await registry.proxies(signers[3].address);
    let contract = await ethers.getContractAt('AuthenticatedProxy',proxy);
    return expect(
      contract.connect(signers[1]).setRevoke(true)
    ).to.be.revertedWith('Authenticated proxy can only be revoked by its user')
  })

  it('should not allow proxy reinitialization',async () => {
    const testAuthenticatedProxyFactory = (await ethers.getContractFactory('TestAuthenticatedProxy', signers[0])) as TestAuthenticatedProxy__factory;
    let testProxy = await testAuthenticatedProxyFactory.deploy();
    await testProxy.deployed();
    await registry.connect(signers[1]).registerProxy();
    let proxy = await registry.proxies(signers[1].address);
    let contract = await ethers.getContractAt('AuthenticatedProxy', proxy);
    let user = await contract.user();
    return expect(
      contract.connect(signers[1]).initialize(registry.address, registry.address)
    ).to.be.revertedWith('Authenticated proxy already initialized')
  })

  it('allows delegateproxy owner change, but only from owner',async () => {
    const testAuthenticatedProxyFactory = (await ethers.getContractFactory('TestAuthenticatedProxy', signers[0])) as TestAuthenticatedProxy__factory;
    let testProxy = await testAuthenticatedProxyFactory.deploy();
    await testProxy.deployed();
    await registry.connect(signers[1]).registerProxy();
    let proxy = await registry.proxies(signers[1].address);
    let contract_at = await ethers.getContractAt('AuthenticatedProxy', proxy);
    let user = await contract_at.user();
    assert.equal(user,signers[1].address)
    let contract = await ethers.getContractAt('TestAuthenticatedProxy', testProxy.address);
    let call = contract.interface.encodeFunctionData("setUser", [signers[4].address])
    await expect(
      contract_at.connect(signers[4]).proxyAssert(testProxy.address,1,call)
    ).to.be.revertedWith('Authenticated proxy can only be called by its user, or by a contract authorized by the registry as long as the user has not revoked access');
    await contract_at.connect(signers[1]).proxyAssert(testProxy.address,1,call,)
    user = await contract_at.user()
    assert.equal(user,signers[4].address,'User was not changed')
  })
})
