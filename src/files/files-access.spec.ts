import { FilesController } from './files.controller';

describe('public image resolver media isolation', () => {
  let controller: FilesController;
  let minio: any;
  let res: any;
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  beforeEach(() => {
    minio = { isEnabled: jest.fn(() => true), getBucketName: jest.fn(() => 'images'), getObjectStream: jest.fn() };
    controller = new FilesController(minio, {} as any, {} as any, {} as any, {} as any);
    res = { setHeader: jest.fn(), type: jest.fn(), write: jest.fn(), end: jest.fn(), on: jest.fn(), once: jest.fn(), emit: jest.fn() };
    global.fetch = fetchMock as any;
    fetchMock.mockReset();
  });
  afterAll(() => { global.fetch = originalFetch; });

  it.each([
    '/uploads/audio/paid.mp3', '/uploads/videos/paid.mp4',
    '/uploads/audio/paid', '/audio/paid.mp3',
    '/images/%2e%2e/audio/paid.mp3', '/uploads/images/%2e%2e/audio/paid.mp3',
    '/uploads/images/%5c..%5caudio%5cpaid.mp3', '/uploads/images/cover.mp3',
  ])('rejects private sources and escaped image paths: %s', async url => {
    await expect(controller.resolvedImage(url, {}, res)).rejects.toThrow();
    expect(minio.getObjectStream).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves public image bucket covers', async () => {
    const stream = { pipe: jest.fn(() => res) };
    minio.getObjectStream.mockResolvedValue({ stream, stat: { metaData: { 'content-type': 'image/png' } } });
    await controller.resolvedImage('http://localhost:9000/images/cover.png', {}, res);
    expect(minio.getObjectStream).toHaveBeenCalledWith('images', 'cover.png');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('never maps an untrusted host containing /images/ to credentialed storage', async () => {
    const cancel = jest.fn();
    fetchMock.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'audio/mpeg' }), body: { cancel } });
    await expect(controller.resolvedImage('https://example.com/images/disguised.png', {}, res)).rejects.toThrow();
    expect(minio.getObjectStream).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'error' }));
  });

  it('rejects non-image objects even inside the image bucket', async () => {
    const stream = { destroy: jest.fn() };
    minio.getObjectStream.mockResolvedValue({ stream, stat: { metaData: { 'content-type': 'video/mp4' } } });
    await expect(controller.resolvedImage('/images/disguised.png', {}, res)).rejects.toThrow();
    expect(stream.destroy).toHaveBeenCalled();
  });
});
