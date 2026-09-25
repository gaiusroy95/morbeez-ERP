import { Test } from '@nestjs/testing';
import { AiService } from './ai.service';

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AiService],
    }).compile();

    service = module.get(AiService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
