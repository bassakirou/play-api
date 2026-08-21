import { PartialType } from '@nestjs/swagger';
import { CreateAudiobookDto } from './create-audiobook.dto';

export class UpdateAudiobookDto extends PartialType(CreateAudiobookDto) {}
