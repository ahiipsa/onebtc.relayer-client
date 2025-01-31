import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import { DBService } from '../database';

import logger from '../../logger';
import { clear } from '../../utils';
const log = logger.module('CommonEntityService:main');

export interface ILogEventsService {
  database: DBService;
  dbCollectionPrefix: string;
  contractAddress: string;
  contractAbi: any[];
}

export class DataLayerService<T> {
  database: DBService;
  dbCollectionPrefix = 'entity';
  lastUpdate = 0;

  nodeURL = process.env.HMY_NODE_URL || 'https://api.s0.b.hmny.io';

  web3: Web3;
  contractAddress: string;
  contractAbi: any;
  contract: Contract;

  observableData: Map<string, T & { id: string }> = new Map();

  constructor(params: ILogEventsService) {
    this.database = params.database;
    this.dbCollectionPrefix = params.dbCollectionPrefix;

    this.web3 = new Web3(this.nodeURL);
    this.contractAddress = params.contractAddress;
    this.contractAbi = params.contractAbi;
    this.contract = new this.web3.eth.Contract(params.contractAbi, params.contractAddress);
  }

  updateOrCreateData = async (data: T & { id: string }) => {
    await this.database.update(
      `${this.dbCollectionPrefix}_data`,
      { id: data.id },
      {
        ...data,
        lastUpdate: Date.now(),
      }
    );
  };

  getInfo = async () => {
    const collectionName = `${this.dbCollectionPrefix}_data`;
    const total = await this.database.getCollectionCount(collectionName);

    return {
      total,
      lastUpdate: this.lastUpdate,
      dbCollectionPrefix: this.dbCollectionPrefix,
    };
  };

  loadAllData = async (): Promise<T[]> => {
    const collectionName = `${this.dbCollectionPrefix}_data`;
    const total = await this.database.getCollectionCount(collectionName);

    return await this.database.getCollectionData(
      collectionName,
      { ['lastUpdate']: -1 },
      Number(total),
      0
    );
  };

  getData = async (params: {
    id?: string;
    size?: number;
    page?: number;
    filter?: Record<string, any>;
    sort?: Record<string, any>;
    collectionName?: string;
  }) => {
    const collectionName = params.collectionName || `${this.dbCollectionPrefix}_data`;

    const from = (params.page || 0) * (params.size || 0);

    const filter = params.filter && clear(params.filter);

    const total = await this.database.getCollectionCount(collectionName, filter);

    const data = await this.database.getCollectionData(
      collectionName,
      params.sort,
      Number(params.size || 0),
      from,
      params.id ? { id: params.id } : filter
    );

    return {
      content: data,
      totalElements: total,
      totalPages: params.size ? Math.ceil(total / params.size) : 1,
      size: params.size || 0,
      page: params.page || 0,
    };
  };

  find = async (id: string) => {
    const collectionName = `${this.dbCollectionPrefix}_data`;
    return await this.database.find(collectionName, { id });
  };
}
