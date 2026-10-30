import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatMessage } from './chat.entity';

const message = (over: Partial<ChatMessage & { senderUserId: string; photoKey: string | null; photoContentType: string | null }> = {}) => ({
  id: 'm1',
  driverEmployeeId: 'driver-1',
  side: 'driver' as const,
  senderName: 'Raju Driver',
  body: 'Reached the farm',
  tripId: null,
  tripNumber: null,
  photo: 'none' as const,
  writtenAt: new Date('2026-10-30T05:00:00Z'),
  createdAt: new Date('2026-10-30T05:00:01Z'),
  senderUserId: 'user-driver',
  photoKey: null,
  photoContentType: null,
  ...over,
});

describe('ChatService (driver app D9)', () => {
  const client = {};
  let repo: Record<string, jest.Mock>;
  let storage: { put: jest.Mock; get: jest.Mock };
  let service: ChatService;

  beforeEach(() => {
    repo = {
      findWithClient: jest.fn().mockResolvedValue(null),
      employeeWithClient: jest.fn().mockResolvedValue({ id: 'driver-1', name: 'Raju Driver' }),
      tripWithClient: jest.fn().mockResolvedValue({ driverEmployeeId: 'driver-1', number: 'T-1' }),
      insertWithClient: jest.fn().mockResolvedValue(true),
      markReadWithClient: jest.fn().mockResolvedValue(new Date()),
      attachPhotoWithClient: jest.fn().mockResolvedValue(true),
    };
    storage = { put: jest.fn(), get: jest.fn() };
    const db = { withTenant: (_t: string, fn: (c: unknown) => unknown) => fn(client) };
    const workforce = { getEmployeeIdForUser: jest.fn().mockResolvedValue('driver-1') };
    service = new ChatService(db as never, storage as never, workforce as never, repo as never);
  });

  it('a driver writes in their own conversation; writing is reading', async () => {
    repo.findWithClient.mockResolvedValueOnce(null).mockResolvedValueOnce(message());
    const sent = await service.sendMine('t', 'user-driver', { id: 'm1', body: '  Reached the farm  ' });
    expect(repo.insertWithClient).toHaveBeenCalledWith(client, 't', expect.objectContaining({ driverEmployeeId: 'driver-1', side: 'driver', body: 'Reached the farm' }));
    expect(repo.markReadWithClient).toHaveBeenCalled();
    expect(sent).not.toHaveProperty('photoKey');
    expect(sent).not.toHaveProperty('senderUserId');
  });

  it('something to say, or a photo', async () => {
    await expect(service.sendMine('t', 'user-driver', { id: 'm1', body: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sent again from the phone, it is the same message; the same id with something else is refused', async () => {
    repo.findWithClient.mockResolvedValue(message());
    expect((await service.sendMine('t', 'user-driver', { id: 'm1', body: 'Reached the farm' })).id).toBe('m1');
    expect(repo.insertWithClient).not.toHaveBeenCalled();
    await expect(service.sendMine('t', 'user-driver', { id: 'm1', body: 'Something else' })).rejects.toBeInstanceOf(ConflictException);
  });

  it("about one of the driver's trips only", async () => {
    repo.tripWithClient.mockResolvedValue({ driverEmployeeId: 'driver-2', number: 'T-9' });
    await expect(service.sendToDriver('t', 'user-owner', 'driver-1', { id: 'm2', body: 'Where are you?', tripId: 'trip-9' })).rejects.toThrow("That isn't one of this driver's trips");
  });

  it('a phone clock ahead never dates a message in the future', async () => {
    repo.findWithClient.mockResolvedValueOnce(null).mockResolvedValueOnce(message());
    await service.sendMine('t', 'user-driver', { id: 'm1', body: 'Late', writtenAt: '2099-01-01T00:00:00Z' });
    expect(repo.insertWithClient.mock.calls[0][2].writtenAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("a login that isn't a worker has no conversation of its own", async () => {
    const workforce = { getEmployeeIdForUser: jest.fn().mockResolvedValue(null) };
    const s = new ChatService({ withTenant: (_t: string, fn: (c: unknown) => unknown) => fn(client) } as never, storage as never, workforce as never, repo as never);
    await expect(s.myThread('t', 'user-x')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the photo follows its message — sent by its sender, once', async () => {
    repo.findWithClient.mockResolvedValue(message({ photo: 'pending' }));
    await service.attachPhoto('t', 'user-driver', false, 'm1', { buffer: Buffer.from('x'), mimetype: 'image/jpeg', size: 1 });
    expect(storage.put).toHaveBeenCalled();
    await expect(service.attachPhoto('t', 'user-owner', true, 'm1', { buffer: Buffer.from('x'), mimetype: 'image/jpeg', size: 1 })).rejects.toBeInstanceOf(ForbiddenException);
    repo.findWithClient.mockResolvedValue(message());
    await expect(service.attachPhoto('t', 'user-driver', false, 'm1', { buffer: Buffer.from('x'), mimetype: 'image/jpeg', size: 1 })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.attachPhoto('t', 'user-driver', false, 'm1', { buffer: Buffer.from('x'), mimetype: 'application/pdf', size: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("a driver sees only their own conversation's photos; the office any", async () => {
    repo.findWithClient.mockResolvedValue(message({ driverEmployeeId: 'driver-2', photo: 'ready', photoKey: 'k', photoContentType: 'image/jpeg' }));
    storage.get.mockResolvedValue(Buffer.from('jpeg'));
    await expect(service.photo('t', 'user-driver', false, 'm1')).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.photo('t', 'user-owner', true, 'm1')).contentType).toBe('image/jpeg');
  });
});
