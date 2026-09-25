import { Module } from '@nestjs/common';

// Kafka-protocol client (Amazon MSK Serverless). Consumers here are
// idempotent on event id (Constitution I.7 / Event Catalog envelope).
@Module({})
export class EventBusModule {}
