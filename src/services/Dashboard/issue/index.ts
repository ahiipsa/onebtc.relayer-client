import EventEmitter = require('events');
import { DataLayerService, ILogEventsService, IssueRequest, IssueRequestEvent } from '../../common';

import logger from '../../../logger';
import {findTxByRedeemId, getTxByParams} from '../../../bitcoin/rpc';
const log = logger.module('Issues:main');

const bitcoin = require('bitcoinjs-lib');
import BN from 'bn.js';

export interface IIssueService extends ILogEventsService {
  eventEmitter: EventEmitter;
  eventName: string;
  methodName: string;
  idEventKey: string;
  listenTxs?: boolean;
}

export class IssueService extends DataLayerService<IssueRequest> {
  eventEmitter: EventEmitter;
  waitInterval = Number(process.env.WAIT_INTERVAL) || 1000;
  eventName: string;
  methodName: string;
  idEventKey: string;
  listenTxs: boolean;

  constructor(params: IIssueService) {
    super(params);
    this.listenTxs = params.listenTxs;

    this.eventEmitter = params.eventEmitter;

    this.eventName = params.eventName;
    this.methodName = params.methodName;
    this.idEventKey = params.idEventKey;
    this.eventEmitter.on(params.eventName, this.addIssue);
  }

  async start() {
    try {
      const data = await this.getData({
        size: 1000,
        page: 0,
        filter: { status: '1' },
        sort: { opentime: -1 },
      });

      const dataWait = await this.getData({
        size: 1000,
        page: 0,
        filter: { status: '0' },
        sort: { opentime: -1 },
      });

      dataWait.content.forEach(item => this.observableData.set(item.id, item));
      data.content.forEach(item => this.observableData.set(item.id, item));

      setTimeout(this.syncData, 100);

      log.info(`Start ${this.eventName} Service - ok`);
    } catch (e) {
      log.error(`Start ${this.eventName}`, { error: e });
      throw new Error(`Start ${this.eventName}: ${e.message}`);
    }
  }

  addIssue = async (data: IssueRequestEvent) => {
    try {
      const { requester, btcAddress, amount } = data.returnValues;
      const id = data.returnValues[this.idEventKey];

      let issueInfo;

      try {
        issueInfo = await this.contract.methods[this.methodName](requester, id).call();
      } catch (e) {
        log.error(`Error ${this.methodName}`, { error: e, data });
      }

      const emb = bitcoin.payments.embed({ data: [new BN(id).toBuffer()] });
      const script = emb.output.toString('hex');

      let issue;

      if(!issueInfo || issueInfo.status === '0') {
        issue = { ...issueInfo, requester, id, script, btcAddress, amount, status: '0' };
      } else {
        issue = { ...issueInfo, requester, id, script };
      }

      if (this.listenTxs) {
        switch (this.idEventKey) {
          case 'issueId':
            issue.btcTx = await getTxByParams({ btcAddress, value: amount });
            break;
          case 'redeemId':
            issue.btcTx = await findTxByRedeemId({ btcAddress, id });
            break;
        }
      }

      await this.updateOrCreateData(issue);

      this.eventEmitter.emit(`ADD_${this.eventName}`, issue);

      if (issue.status === '1' || issue.status === '0') {
        this.observableData.set(id, issue);
      }
    } catch (e) {
      log.error(`Error addIssue`, { error: e, data });
    }
  };

  syncData = async () => {
    try {
      // TODO: next requests not parallel - need to optimise fro 20+ items
      for (let item of this.observableData.values()) {
        try {
          const { requester, id } = item;

          const issueInfo = await this.contract.methods[this.methodName](requester, id).call();
          
          let issueUpd;

          if(issueInfo.status === '0') {
            issueUpd = { ...item, requester, id };
          } else {
            issueUpd = { ...issueInfo, requester, id };
          }

          if (this.listenTxs) {
            const { btcAddress, amount } = issueUpd;

            switch (this.idEventKey) {
              case 'issueId':
                issueUpd.btcTx = await getTxByParams({ btcAddress, value: amount });
                break;
              case 'redeemId':
                issueUpd.btcTx = await findTxByRedeemId({ btcAddress, id });
                break;
            }
          }

          await this.updateOrCreateData(issueUpd);

          this.eventEmitter.emit(`UPDATE_${this.eventName}`, issueUpd);

          if (issueUpd.status !== '1' && issueUpd.status !== '0') {
            this.observableData.delete(id);
          }
        } catch (e) {
          log.error('Error update Vault', { error: e, issue: item });
        }
      }

      this.lastUpdate = Date.now();
    } catch (e) {
      log.error('Error syncVaults', { error: e });
    }

    setTimeout(this.syncData, this.waitInterval);
  };
}
