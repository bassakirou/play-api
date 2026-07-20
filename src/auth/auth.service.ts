import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';

import { MailService } from '../mail/mail.service';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private mailService: MailService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    console.log(`[AuthService] Validation pour: ${email}`);
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      console.log(`[AuthService] Utilisateur non trouvé pour: ${email}`);
      return null;
    }

    console.log(
      `[AuthService] Utilisateur trouvé. Vérification du mot de passe...`,
    );
    const isMatch = await bcrypt.compare(pass, user.password);
    console.log(`[AuthService] Résultat comparaison bcrypt: ${isMatch}`);

    if (isMatch) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = { email: user.email, sub: user.id, role: user.role.name };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async register(registerDto: CreateUserDto) {
    const user = await this.usersService.create(registerDto);
    const payload = {
      email: user.email,
      sub: user.id,
      role: registerDto.role || 'USER',
    };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Don't reveal user existence
      return { message: 'If this email exists, a reset link has been sent.' };
    }

    const token = randomBytes(32).toString('hex');
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 1); // 1 hour expiry

    await this.usersService.update(user.id, {
      resetToken: token,
      resetTokenExpiry: expiry,
    });

    await this.mailService.sendResetPasswordEmail(email, token);
    return { message: 'Reset link sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    // Find user by token
    // Since UsersService doesn't have findByResetToken, we might need to add it or do it here if we inject PrismaService (but AuthService doesn't).
    // Better to add findByResetToken to UsersService.
    const user = await this.usersService.findByResetToken(token);

    if (!user || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.usersService.update(user.id, {
      password: hashedPassword,
      resetToken: null,
      resetTokenExpiry: null,
    });

    return { message: 'Password reset successful.' };
  }

  async setupFirstAdmin(createUserDto: CreateUserDto) {
    const users = await this.usersService.findAll();
    console.log(`[AuthService] Nombre d'utilisateurs actuels: ${users.length}`);
    if (users.length > 0) {
      console.log(
        '[AuthService] Liste des utilisateurs existants:',
        users.map((u) => u.email),
      );
      throw new UnauthorizedException('Super Admin already exists');
    }

    console.log(
      `[AuthService] Création du premier administrateur: ${createUserDto.email}`,
    );

    const user = await this.usersService.create({
      ...createUserDto,
      role: 'ADMIN',
    });

    const payload = { email: user.email, sub: user.id, role: 'ADMIN' };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async checkSetupStatus() {
    const users = await this.usersService.findAll();
    return { isSetup: users.length > 0 };
  }

  async changePassword(userId: string, currentPass: string, newPass: string) {
    const user = await this.usersService.findOne(userId);
    if (!user || !(await bcrypt.compare(currentPass, user.password))) {
      throw new UnauthorizedException('Invalid current password');
    }

    const hashedPassword = await bcrypt.hash(newPass, 10);
    await this.usersService.update(userId, { password: hashedPassword });

    return { message: 'Password changed successfully' };
  }

  async checkEmail(email: string) {
    const user = await this.usersService.findByEmail(email);
    return { exists: !!user };
  }
}
