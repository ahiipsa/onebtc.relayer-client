import { asyncHandler, parseSort } from './helpers';
import { IServices } from '../services/init';

export const routes = (app, services: IServices) => {
  app.get(
    '/relay/height',
    asyncHandler(async (req, res) => {
      const data = await services.relayerClient.getLastRelayBlock();
      return res.json(data);
    })
  );

  app.get(
    '/relay/info',
    asyncHandler(async (req, res) => {
      const data = await services.relayerClient.getInfo();
      return res.json(data);
    })
  );

  app.get(
    '/oracle/info',
    asyncHandler(async (req, res) => {
      const data = await services.oracleClient.getInfo();
      return res.json(data);
    })
  );

  app.get(
    '/relay/events/info',
    asyncHandler(async (req, res) => {
      const data = await services.relayEvents.getInfo();
      return res.json(data);
    })
  );

  app.get(
    '/relay/events/data',
    asyncHandler(async (req, res) => {
      const { size = 50, page = 0 } = req.query;
      const data = await services.relayEvents.getAllEvents({
        size,
        page,
        sort: { blockNumber: -1 },
      });
      return res.json(data);
    })
  );

  app.get(
    '/main-events/info',
    asyncHandler(async (req, res) => {
      const data = await services.onebtcEvents.getInfo();
      return res.json(data);
    })
  );

  app.get(
    '/main-events/data',
    asyncHandler(async (req, res) => {
      const { size = 50, page = 0 } = req.query;
      const data = await services.onebtcEvents.getAllEvents({
        size,
        page,
        sort: { blockNumber: -1 },
      });
      return res.json(data);
    })
  );

  app.get(
    '/vaults/info',
    asyncHandler(async (req, res) => {
      const data = await services.vaults.getInfo();
      return res.json(data);
    })
  );

  app.get(
    '/vaults/data',
    asyncHandler(async (req, res) => {
      const { size = 50, page = 0, id, sort } = req.query;
      const sorting = parseSort(sort, {lastUpdate: -1});
      const data = await services.vaults.getData({ size, page, id, sort: sorting });
      return res.json(data);
    })
  );

  app.get(
    '/vaults/data/:id',
    asyncHandler(async (req, res) => {
      const data = await services.vaults.find(req.params.id);
      return res.json(data);
    })
  );

  app.get(
    '/issues/info',
    asyncHandler(async (req, res) => {
      const data = await services.issues.getInfo();
      return res.json(data);
    })
  );

  app.get(
    '/issues/data',
    asyncHandler(async (req, res) => {
      const { size = 50, page = 0, requester, vault, id, sort } = req.query;

      const sorting = parseSort(sort, { opentime: -1 });

      const data = await services.issues.getData({
        size,
        page,
        sort: sorting,
        filter: {
          requester,
          vault,
          id,
        },
      });

      return res.json(data);
    })
  );

  app.get(
    '/issues/data/:id',
    asyncHandler(async (req, res) => {
      const data = await services.issues.find(req.params.id);
      return res.json(data);
    })
  );

  app.get(
    '/redeems/info',
    asyncHandler(async (req, res) => {
      const data = await services.redeems.getInfo();
      return res.json(data);
    })
  );

  app.get(
    '/redeems/data',
    asyncHandler(async (req, res) => {
      const { size = 50, page = 0, requester, vault, id, sort } = req.query;

      const sorting = parseSort(sort, { opentime: -1 });

      const data = await services.redeems.getData({
        size,
        page,
        sort: sorting,
        filter: {
          requester,
          vault,
          id,
        },
      });

      return res.json(data);
    })
  );

  app.get(
    '/redeems/data/:id',
    asyncHandler(async (req, res) => {
      const data = await services.redeems.find(req.params.id);
      return res.json(data);
    })
  );

  app.get(
    '/monitor',
    asyncHandler(async (req, res) => {
      const relayerClient = await services.relayerClient.getInfo();
      const relayEvents = await services.relayEvents.getInfo();
      const mainEvents = await services.onebtcEvents.getInfo();
      const issues = await services.issues.getInfo();
      const redeems = await services.redeems.getInfo();
      const vaults = await services.vaults.getInfo();

      return res.json({
        relayerClient,
        relayEvents,
        mainEvents,
        issues,
        redeems,
        vaults,
      });
    })
  );

  app.get(
    '/operations/data',
    asyncHandler(async (req, res) => {
      const { size = 50, page = 0, requester, vault, id, sort } = req.query;

      const sorting = parseSort(sort, { timestamp: -1 });

      const data = await services.vaultClient.getData({
        size,
        page,
        sort: sorting,
        filter: {
          requester,
          vault,
          id,
        },
      });

      res.header('Content-Type', 'application/json');
      res.send(JSON.stringify(data, null, 4));
    })
  );

  app.get(
    '/vault-client/info',
    asyncHandler(async (req, res) => {
      const data = await services.vaultClient.info();

      res.header('Content-Type', 'application/json');
      res.send(JSON.stringify(data, null, 4));
    })
  );

  app.post(
    '/vault-client/register',
    asyncHandler(async (req, res) => {
      const data = await services.vaultClient.register(req.body.collateral);

      res.header('Content-Type', 'application/json');
      res.send(JSON.stringify(data, null, 4));
    })
  );

  app.get(
    '/vault-client/outputs',
    asyncHandler(async (req, res) => {
      const data = await services.vaultClient.walletBTC.getFreeOutputs(
        req.query.amount || 0,
        !req.query.amount
      );

      res.header('Content-Type', 'application/json');
      res.send(JSON.stringify(data, null, 4));
    })
  );

  app.post(
    '/monitor/ping',
    asyncHandler(async (req, res) => {
      await services.vaults.ping(req.body.vault);

      res.send(JSON.stringify({ status: true }, null, 4));
    })
  );

  app.get(
    '/history/:collection',
    asyncHandler(async (req, res) => {
      const { size = 50, page = 0, step = 'h' } = req.query;
      const { collection } = req.params;

      const data = await services.history.getHistoryData(
        {
          size,
          page,
          collectionName: `history_${collection}`,
        },
        step
      );

      res.send(data);
    })
  );
};
