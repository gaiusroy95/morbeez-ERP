import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { LineMeasure } from '../measures';

/** An order line as delivery measures need it: what kind of product, and the loss the owner accepts on it. */
export interface DeliveryLineFacts {
  orderLineId: string;
  productId: string;
  productName: string;
  kind: 'standard' | 'live_bird' | 'egg';
  uom: string;
  quantity: string;
  /** The product's own tolerance, or the business default for its kind; null for standard products. */
  tolerancePct: string | null;
  /** Business rule: a photo of the customer's scale when their weight is entered. */
  weighmentPhoto: 'optional' | 'required' | 'not_required';
}

/** A delivery line that lost more than the owner accepts — for the trip review. */
export interface LossException {
  stopName: string;
  product: string;
  uom: string;
  kind: 'weighment' | 'breakage';
  dispatched: string;
  settled: string;
  lossPct: string;
  tolerancePct: string;
}

@Injectable()
export class DeliveryMeasuresRepository {
  async lineFactsWithClient(client: PoolClient, orderId: string): Promise<DeliveryLineFacts[]> {
    const result = await client.query<{
      order_line_id: string;
      product_id: string;
      product_name: string;
      kind: DeliveryLineFacts['kind'];
      uom: string;
      quantity: string;
      tolerance_pct: string | null;
      weighment_photo: DeliveryLineFacts['weighmentPhoto'];
    }>(
      `SELECT ol.id AS order_line_id, p.id AS product_id, p.name AS product_name, p.kind, p.base_uom AS uom,
              ol.quantity::text AS quantity,
              COALESCE(p.loss_tolerance_pct,
                       CASE p.kind WHEN 'live_bird' THEN t.default_shrinkage_tolerance_pct
                                   WHEN 'egg' THEN t.default_breakage_tolerance_pct END)::text AS tolerance_pct,
              t.weighment_photo
         FROM commerce.customer_order_line ol
         JOIN trading_partners.product p ON p.id = ol.product_id
         JOIN tenant.tenant t ON t.id = p.tenant_id
        WHERE ol.order_id = $1
        ORDER BY ol.created_at`,
      [orderId],
    );
    return result.rows.map((r) => ({
      orderLineId: r.order_line_id,
      productId: r.product_id,
      productName: r.product_name,
      kind: r.kind,
      uom: r.uom,
      quantity: r.quantity,
      tolerancePct: r.tolerance_pct,
      weighmentPhoto: r.weighment_photo,
    }));
  }

  async insertWithClient(
    client: PoolClient,
    tenantId: string,
    recordedBy: string,
    fields: { tripStopId: string; orderLineId: string; productId: string; measure: LineMeasure },
  ): Promise<void> {
    const m = fields.measure;
    await client.query(
      `INSERT INTO fulfilment.delivery_line_measure
         (tenant_id, trip_stop_id, order_line_id, product_id, kind, dispatched_quantity, settled_quantity,
          loss_quantity, loss_pct, tolerance_pct, within_tolerance, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (order_line_id) DO NOTHING`,
      [tenantId, fields.tripStopId, fields.orderLineId, fields.productId, m.kind, m.dispatched, m.settled, m.loss, m.lossPct, m.tolerancePct, m.withinTolerance, recordedBy],
    );
  }

  async lossExceptionsForTripWithClient(client: PoolClient, tripId: string): Promise<LossException[]> {
    const result = await client.query<{
      stop_name: string;
      product: string;
      uom: string;
      kind: LossException['kind'];
      dispatched: string;
      settled: string;
      loss_pct: string;
      tolerance_pct: string;
    }>(
      `SELECT c.name AS stop_name, p.name AS product, p.base_uom AS uom, m.kind,
              m.dispatched_quantity::text AS dispatched, m.settled_quantity::text AS settled,
              m.loss_pct::text AS loss_pct, m.tolerance_pct::text AS tolerance_pct
         FROM fulfilment.delivery_line_measure m
         JOIN fulfilment.trip_stop s ON s.id = m.trip_stop_id
         JOIN commerce.customer_order o ON o.id = s.order_id
         JOIN trading_partners.customer c ON c.id = o.customer_id
         JOIN trading_partners.product p ON p.id = m.product_id
        WHERE s.trip_id = $1 AND NOT m.within_tolerance
        ORDER BY s.sequence_number`,
      [tripId],
    );
    return result.rows.map((r) => ({
      stopName: r.stop_name,
      product: r.product,
      uom: r.uom,
      kind: r.kind,
      dispatched: r.dispatched,
      settled: r.settled,
      lossPct: r.loss_pct,
      tolerancePct: r.tolerance_pct,
    }));
  }

  /** Each measured line on a stop — shown with the delivery. */
  async listByStopWithClient(client: PoolClient, tripStopId: string) {
    const result = await client.query(
      `SELECT m.order_line_id AS "orderLineId", p.name AS product, p.base_uom AS uom, m.kind,
              m.dispatched_quantity::text AS dispatched, m.settled_quantity::text AS settled, m.loss_quantity::text AS loss,
              m.loss_pct::text AS "lossPct", m.tolerance_pct::text AS "tolerancePct", m.within_tolerance AS "withinTolerance"
         FROM fulfilment.delivery_line_measure m JOIN trading_partners.product p ON p.id = m.product_id
        WHERE m.trip_stop_id = $1`,
      [tripStopId],
    );
    return result.rows;
  }
}
