# Amazon MSK Serverless — durable, replayable Kafka-protocol log (System Architecture, EVT.2).
#
# Deliberately not provisioned yet: nothing publishes to it. The
# transactional outbox (infra/outbox/outbox-relay.ts) is still a stub, so an
# MSK cluster would cost money and carry no events. Wire this module into the
# environments in the same change that makes the outbox relay real, together
# with the worker service that runs it (Deployment plan, scaling step 4).
