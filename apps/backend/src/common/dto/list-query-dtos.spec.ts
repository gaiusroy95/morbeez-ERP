import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListOrdersQueryDto } from '../../modules/orders/dto/list-orders-query.dto';
import { ListPurchaseOrdersQueryDto } from '../../modules/procurement/dto/list-purchase-orders-query.dto';
import { ListTripsQueryDto } from '../../modules/logistics/dto/list-trips-query.dto';
import { ListApprovalRequestsQueryDto } from '../../modules/approvals/dto/list-approval-requests-query.dto';
import { PaginationQueryDto } from './pagination-query.dto';

// Same options as the global pipe in app.module.ts. A list filter declared
// as a bare @Query('status') next to a PaginationQueryDto is rejected by
// forbidNonWhitelisted — that shipped once, so pin it down.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const asQuery = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'query', metatype });

describe('list query DTOs', () => {
  it.each([
    [ListOrdersQueryDto, 'confirmed'],
    [ListPurchaseOrdersQueryDto, 'graded'],
    [ListTripsQueryDto, 'in_progress'],
    [ListApprovalRequestsQueryDto, 'pending'],
  ])('%p accepts a valid status alongside paging', async (dto, status) => {
    const result = await pipe.transform({ status, page: '2', pageSize: '10' }, asQuery(dto));
    expect(result).toMatchObject({ status, page: 2, pageSize: 10 });
  });

  it.each([ListOrdersQueryDto, ListPurchaseOrdersQueryDto, ListTripsQueryDto, ListApprovalRequestsQueryDto])(
    '%p rejects an unknown status',
    async (dto) => {
      await expect(pipe.transform({ status: 'bogus' }, asQuery(dto))).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('plain pagination still refuses undeclared filters', async () => {
    await expect(pipe.transform({ status: 'placed' }, asQuery(PaginationQueryDto))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
