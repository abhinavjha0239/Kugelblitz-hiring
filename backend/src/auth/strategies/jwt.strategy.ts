import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    role: string;
    // Set by the magic-link consume path (see magic-link.service.ts). Marks
    // this session as locked to a single test. The InviteScopeGuard reads
    // it from req.user on every guarded request to enforce per-candidate
    // scope. Absent on admin / password-based logins (free-roam).
    inviteScope?: { testId: string; magicLinkId: string; lockedToTest: true };
  }) {
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or deactivated');
    }
    // CRITICAL: read inviteScope from the JWT payload (signature-protected),
    // NOT from the User row. The User row has no notion of "current session
    // is for which test"; that's a property of the token itself.
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      inviteScope: payload.inviteScope,
    };
  }
}
