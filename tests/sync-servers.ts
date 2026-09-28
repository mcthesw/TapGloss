import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import S3rver from 's3rver';
import { v2 as dav } from 'webdav-server';
import { syncSettingsSchema } from '../src/domain/sync';

export async function startSyncServer(backend: 's3' | 'webdav') {
  if (backend === 's3') {
    const directory = await mkdtemp(join(tmpdir(), 'tapgloss-s3-'));
    const server = new S3rver({
      address: '127.0.0.1',
      port: 0,
      silent: true,
      directory,
      configureBuckets: [{ name: 'tapgloss-test', configs: [] }],
    });
    const { port } = await server.run();
    return {
      config: syncSettingsSchema.parse({
        backend,
        endpoint: `http://127.0.0.1:${port}`,
        bucket: 'tapgloss-test',
        username: 'S3RVER',
        password: 'S3RVER',
      }),
      close: async () => {
        await server.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  }
  const users = new dav.SimpleUserManager();
  const user = users.addUser('test-user', 'test-password', false);
  const privileges = new dav.SimplePathPrivilegeManager();
  privileges.setRights(user, '/', ['all']);
  const server = new dav.WebDAVServer({
    httpAuthentication: new dav.HTTPBasicAuthentication(users),
    privilegeManager: privileges,
  });
  const http = createServer((request, response) => server.executeRequest(request, response));
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return {
    config: syncSettingsSchema.parse({
      backend,
      endpoint: `http://127.0.0.1:${address.port}`,
      username: 'test-user',
      password: 'test-password',
    }),
    close: () => new Promise<void>((done) => http.close(() => done())),
  };
}
