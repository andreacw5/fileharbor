import { Injectable } from '@nestjs/common';
import generator from 'generate-password-ts';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  /**
   * Generates a password
   */
  async generateAPassword() {
    const password = generator.generate({
      length: 30,
      numbers: true,
      symbols: true,
    });

    const saltOrRounds = 15;
    return bcrypt.hashSync(password, saltOrRounds);
  }

  /**
   * Compares a password with a hash
   * @param password
   * @param hash
   */
  async comparePassword(password: string, hash: string) {
    return bcrypt.compareSync(password, hash);
  }
}
