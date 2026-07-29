import { Controller, Get, Res } from '@nestjs/common';
import { AppService } from './app.service';
import * as fs from 'fs';
import * as path from 'path';
import { Response } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('changelog')
  getChangelog(@Res() res: Response) {
    try {
      const changelogPath = path.join(process.cwd(), '../../CHANGELOG.md');
      if (fs.existsSync(changelogPath)) {
        const content = fs.readFileSync(changelogPath, 'utf8');
        return res.send(content);
      }
      return res.status(404).send('Changelog not found');
    } catch (e) {
      return res.status(500).send('Error reading changelog');
    }
  }
}
