import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersRepository } from './repositories/users.repository';
import { RolesRepository } from './repositories/roles.repository';
import { AuthSessionsRepository } from './repositories/auth-sessions.repository';
import { PasswordService } from './security/password.service';
import { UserRecord } from './entities/user.entity';

const mockUser: UserRecord = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'owner@example.com',
  phone: '+919822011111',
  passwordHash: 'hashed',
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UsersService', () => {
  let service: UsersService;
  let usersRepo: jest.Mocked<UsersRepository>;
  let sessionsRepo: jest.Mocked<AuthSessionsRepository>;
  let password: jest.Mocked<PasswordService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useValue: {
            list: jest.fn(),
            create: jest.fn(),
            findById: jest.fn(),
            updateStatus: jest.fn(),
            updatePasswordHash: jest.fn(),
          },
        },
        {
          provide: RolesRepository,
          useValue: { assignToUser: jest.fn() },
        },
        {
          provide: AuthSessionsRepository,
          useValue: { revokeAllForUser: jest.fn() },
        },
        {
          provide: PasswordService,
          useValue: { hash: jest.fn(), verify: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(UsersService);
    usersRepo = module.get(UsersRepository);
    sessionsRepo = module.get(AuthSessionsRepository);
    password = module.get(PasswordService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('hashes the password before storing a new user, never the plaintext', async () => {
    password.hash.mockResolvedValue('hashed-value');
    usersRepo.create.mockResolvedValue(mockUser);

    await service.create('tenant-1', { phone: '+919822011111' }, 'a-real-password');

    expect(password.hash).toHaveBeenCalledWith('a-real-password');
    expect(usersRepo.create).toHaveBeenCalledWith(
      'tenant-1',
      { phone: '+919822011111' },
      'hashed-value',
    );
  });

  it('translates a duplicate-login constraint violation into a 409 naming what is taken', async () => {
    password.hash.mockResolvedValue('hashed-value');
    usersRepo.create.mockRejectedValue({ code: '23505', constraint: 'app_user_phone_unique' });

    const attempt = service.create('tenant-1', { phone: '+919822011111' }, 'a-real-password');
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(/mobile number already has a Morbeez login/);
  });

  it('deactivating a user revokes every session they currently hold', async () => {
    usersRepo.updateStatus.mockResolvedValue({ ...mockUser, status: 'deactivated' });

    await service.deactivate('tenant-1', 'user-1');

    expect(sessionsRepo.revokeAllForUser).toHaveBeenCalledWith('tenant-1', 'user-1');
  });

  it('throws NotFound rather than silently no-op-ing on an unknown user', async () => {
    usersRepo.updateStatus.mockResolvedValue(null);

    await expect(service.deactivate('tenant-1', 'nonexistent')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a password change when the current password is wrong', async () => {
    usersRepo.findById.mockResolvedValue(mockUser);
    password.verify.mockResolvedValue(false);

    await expect(
      service.changePassword('tenant-1', 'user-1', 'wrong-password', 'new-password-123'),
    ).rejects.toThrow();
    expect(usersRepo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('a successful password change revokes every existing session', async () => {
    usersRepo.findById.mockResolvedValue(mockUser);
    password.verify.mockResolvedValue(true);
    password.hash.mockResolvedValue('new-hashed-value');

    await service.changePassword('tenant-1', 'user-1', 'current-password', 'new-password-123');

    expect(usersRepo.updatePasswordHash).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'new-hashed-value',
    );
    expect(sessionsRepo.revokeAllForUser).toHaveBeenCalledWith('tenant-1', 'user-1');
  });
});
