import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { InvoiceKind } from '../entities/finance-engine.entity';

export class ListInvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: ['all', 'open', 'overdue', 'paid'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'open', 'overdue', 'paid'])
  state?: 'all' | 'open' | 'overdue' | 'paid';

  @ApiPropertyOptional({ enum: ['sale', 'finance_charge'] })
  @IsOptional()
  @IsIn(['sale', 'finance_charge'])
  kind?: InvoiceKind;
}

export class CustomerScopedQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class FarmerScopedQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  farmerId?: string;
}
