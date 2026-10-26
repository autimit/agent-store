import {createAuthEndpoint, sessionMiddleware, APIError} from 'better-auth/api';

// Account management orchestration only. Better Auth still owns authorization,
// token issuance/validation, password hashing, cookies and OAuth grants.
export function storeAccountPlugin() {
  return {id: 'agent-store-account', endpoints: {
    disconnectStoreAgent: createAuthEndpoint('/store/disconnect', {method: 'POST', use: [sessionMiddleware]}, async ctx => {
      const id = ctx.body?.id;
      if (typeof id !== 'string' || id.length > 256) throw new APIError('BAD_REQUEST');
      const adapter = ctx.context.adapter;
      const account = ctx.context.session.user.id;
      const consent = await adapter.findOne({model: 'oauthConsent', where: [{field: 'id', value: id}, {field: 'userId', value: account}]});
      if (!consent) throw new APIError('NOT_FOUND');
      const where = [{field: 'clientId', value: consent.clientId}, {field: 'userId', value: account}];
      const update = {revoked: new Date()};
      await adapter.updateMany({model: 'oauthRefreshToken', where, update});
      await adapter.updateMany({model: 'oauthAccessToken', where, update});
      await adapter.delete({model: 'oauthConsent', where: [{field: 'id', value: id}, {field: 'userId', value: account}]});
      return ctx.json({disconnected: true});
    }),
  }};
}
