import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { CustomerOpeningBalance, FarmerOpeningBalance, OpeningBalancesService } from './opening-balances.service';
import { OpeningBalanceDto } from './dto/opening-balance.dto';

// Opening balances are entries in the books against equity — posted by whoever
// may post journals (accounting:post: the owner and the accountant).
@ApiTags('finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('finance')
export class OpeningBalancesController {
  constructor(private readonly opening: OpeningBalancesService) {}

  /** What the customer already owed: OB-000001, once. */
  @Post('customers/:customerId/opening-balance')
  @RequirePermissions('accounting:post')
  forCustomer(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: OpeningBalanceDto,
  ): Promise<CustomerOpeningBalance> {
    return this.opening.forCustomer(user.tenantId, user.userId, customerId, dto);
  }

  /** What was already owed to the farmer, once. */
  @Post('farmers/:farmerId/opening-balance')
  @RequirePermissions('accounting:post')
  forFarmer(
    @CurrentUser() user: AuthContext,
    @Param('farmerId', ParseUUIDPipe) farmerId: string,
    @Body() dto: OpeningBalanceDto,
  ): Promise<FarmerOpeningBalance> {
    return this.opening.forFarmer(user.tenantId, user.userId, farmerId, dto);
  }
}
