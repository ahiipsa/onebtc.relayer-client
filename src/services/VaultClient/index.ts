import EventEmitter = require('events');
import {
  CONTRACT_EVENT,
  DataLayerService,
  ILogEventsService,
  IssueRequestEvent,
  RedeemRequest,
} from '../common';
import { IServices } from '../init';
import { IOperationInitParams, Operation } from './Operation';
import { OPERATION_TYPE, STATUS } from './interfaces';
import { WalletBTC } from './WalletBTC';
import { HmyContractManager } from '../../harmony/HmyContractManager';
import logger from '../../logger';
import { bn } from '../../utils';
import { Buffer } from 'buffer';
import axios from 'axios';

const bitcoin = require('bitcoinjs-lib');

const log = logger.module('VaultClient:main');

export interface IVaultClient extends ILogEventsService {
  eventEmitter: EventEmitter;
  services: IServices;
}

enum RELAYER_STATUS {
  STOPPED = 'STOPPED',
  LAUNCHED = 'LAUNCHED',
  PAUSED = 'PAUSED',
}

export class VaultClient extends DataLayerService<IOperationInitParams> {
  eventEmitter: EventEmitter;

  hmyContractManager: HmyContractManager;

  services: IServices;

  operations: Operation[] = [];

  waitInterval = Number(process.env.WAIT_INTERVAL) || 1000;
  walletBTC: WalletBTC;

  status = RELAYER_STATUS.STOPPED;

  constructor(params: IVaultClient) {
    super(params);

    this.services = params.services;
    this.eventEmitter = params.eventEmitter;
  }

  async start() {
    try {
      if (process.env.HMY_VAULT_PRIVATE_KEY) {
        this.hmyContractManager = new HmyContractManager({
          hmyPrivateKey: process.env.HMY_VAULT_PRIVATE_KEY,
          contractAddress: this.contractAddress,
          contractAbi: this.contractAbi,
          nodeUrl: process.env.HMY_NODE_URL,
        });
      } else {
        throw new Error('HMY_VAULT_PRIVATE_KEY not found');
      }

      if (process.env.BTC_VAULT_PRIVATE_KEY) {
        this.walletBTC = new WalletBTC({
          services: this.services,
          vaultId: this.hmyContractManager.masterAddress,
          btcPrivateKey: process.env.BTC_VAULT_PRIVATE_KEY,
        });
      } else {
        throw new Error('BTC_VAULT_PRIVATE_KEY not found');
      }

      this.eventEmitter.on(`ADD_${CONTRACT_EVENT.RedeemRequest}`, this.addRedeem);

      this.status = RELAYER_STATUS.LAUNCHED;

      setInterval(this.pingDashboard, 30000);

      log.info(`Start Vault Client - ok`);

      await this.loadOperationsFromDB();
    } catch (e) {
      log.error(`Start Vault Client - failed`, { error: e });
      // throw new Error(`Start Vault Client: ${e.message}`);
    }
  }

  isCorrectVault = (vaultId: string) =>
    vaultId.toLowerCase() === this.hmyContractManager.masterAddress.toLowerCase();

  onIssueRequest = async (data: IssueRequestEvent) => {
    if (this.isCorrectVault(data.returnValues.vaultId)) {
    }
  };

  saveOperationToDB = async (operation: Operation) => {
    return await this.updateOrCreateData(operation.toObject({ payload: true }));
  };

  loadOperationsFromDB = async () => {
    const res = await this.getData({
      size: 1000,
      page: 0,
      filter: { status: 'in_progress' },
      sort: { timestamp: -1 },
    });

    res.content.forEach(params => {
      log.info('Restore operation', {
        id: params.id,
        type: params.type,
        btcAddress: params.btcAddress,
        vault: params.vault,
        requester: params.requester,
        amount: params.amount,
      });

      const operation = new Operation();

      operation.asyncConstructor(
        params,
        this.saveOperationToDB,
        this.walletBTC,
        this.hmyContractManager
      );

      this.operations.push(operation);
    });
  };

  createOperation = async (params: IOperationInitParams) => {
    if (this.operations.find(o => o.id === params.id)) {
      // log.error('Operation already created', { params });
      return;
    }

    log.info('Start new operation', { params });

    const operation = new Operation();

    await operation.asyncConstructor(
      {
        id: params.id,
        type: params.type,
        btcAddress: params.btcAddress,
        vault: params.vault,
        requester: params.requester,
        amount: params.amount,
      },
      this.saveOperationToDB,
      this.walletBTC,
      this.hmyContractManager
    );

    await this.saveOperationToDB(operation);

    this.operations.push(operation);

    return operation.toObject();
  };

  addRedeem = async (redeem: RedeemRequest) => {
    if (this.isCorrectVault(redeem.vault) && redeem.status === '1') {
      await this.createOperation({
        id: redeem.id,
        type: OPERATION_TYPE.REDEEM,
        vault: redeem.vault,
        requester: redeem.requester,
        btcAddress: redeem.btcAddress,
        amount: redeem.amountBtc,
      });
    }
  };

  info = async () => {
    const operations = await this.getInfo();

    const eventsInfo = await this.services.onebtcEvents.getInfo();
    const synchronized = parseInt(eventsInfo.progress) === 1;

    const vault = await this.hmyContractManager.getVaultInfo();

    const balances = await this.walletBTC.getBalances();

    return {
      synchronized,
      syncProgress: eventsInfo.progress,
      registered: !!vault,
      status: this.status,
      vaultAddress: this.hmyContractManager.masterAddress,
      vaultInfo: vault,
      contract: this.contractAddress,
      balances,
      operations,
    };
  };

  register = async (collateral: string) => {
    const vaultEcPair = bitcoin.ECPair.fromPrivateKey(
      Buffer.from(process.env.BTC_VAULT_PRIVATE_KEY, 'hex'),
      { compressed: false }
    );

    const pubX = bn(vaultEcPair.publicKey.slice(1, 33));
    const pubY = bn(vaultEcPair.publicKey.slice(33, 65));

    return await this.hmyContractManager.register(collateral, pubX, pubY);
  };

  pingDashboard = async () => {
    try {
      await axios.post(`${process.env.DASHBOARD_URL}/monitor/ping`, {
        vault: this.hmyContractManager.masterAddress,
      });
    } catch (e) {
      log.error('Error ping dashboard', { error: e });
    }
  };
}
