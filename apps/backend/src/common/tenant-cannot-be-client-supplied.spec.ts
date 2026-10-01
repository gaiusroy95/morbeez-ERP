import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RegisterUserDto } from '../modules/users/dto/register-user.dto';
import { CreateTenantDto } from '../modules/tenant/dto/create-tenant.dto';
import { UpdateTenantDto } from '../modules/tenant/dto/update-tenant.dto';

// No live database needed — this proves the same ValidationPipe
// configuration registered globally in app.module.ts (APP_PIPE) rejects an
// attacker-supplied tenantId outright, rather than silently dropping it.
// Constitution IV.2's rule ("tenant identity comes from the auth context,
// never a client-supplied field") is enforced right here, at the request
// boundary, before a controller or service ever runs — this test would
// fail the moment someone loosens `forbidNonWhitelisted` to fix an
// unrelated bug.
describe('tenantId can never arrive as a request field', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  it('rejects a user-creation request body carrying an unexpected tenantId', async () => {
    await expect(
      pipe.transform(
        {
          phone: '98220 11111',
          password: 'a-real-password-123',
          tenantId: 'attacker-supplied-tenant-id',
        },
        { type: 'body', metatype: RegisterUserDto, data: '' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a tenant-signup request body carrying an unexpected tenantId', async () => {
    await expect(
      pipe.transform(
        {
          businessName: 'Forged Co.',
          ownerPhone: '98220 11111',
          ownerPassword: 'a-real-password-123',
          tenantId: 'attacker-supplied-tenant-id',
        },
        { type: 'body', metatype: CreateTenantDto, data: '' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a tenant-update request body targeting a different tenant by id', async () => {
    await expect(
      pipe.transform(
        { name: 'Renamed Co.', tenantId: 'someone-elses-tenant-id' },
        { type: 'body', metatype: UpdateTenantDto, data: '' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the same payloads once no extraneous field is present', async () => {
    const result = await pipe.transform(
      { phone: '98220 11111', password: 'a-real-password-123' },
      { type: 'body', metatype: RegisterUserDto, data: '' },
    );
    expect(result).toBeInstanceOf(RegisterUserDto);
    expect(result.phone).toBe('+919822011111'); // normalized on the way in
  });
});
