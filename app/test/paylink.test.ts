import { describe, expect, it } from 'vitest';
import { accountProblem, amountProblem } from '../lib/paylink';

describe('payment links', () => {
  it('accept NEAR mainnet accounts, named or implicit, and nothing else', () => {
    expect(accountProblem('godswillidolor.near')).toBeNull();
    expect(accountProblem('a-b_c.sub.near')).toBeNull();
    expect(accountProblem('5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd')).toBeNull();
    expect(accountProblem('dues-freelancer.testnet')).toMatch(/testnet/);
    expect(accountProblem('Bob.near')).toMatch(/not a valid/);
    expect(accountProblem('bob..near')).toMatch(/not a valid/);
    expect(accountProblem('')).toMatch(/Enter/);
  });

  it('take dollar amounts from $1 to $10,000 with at most cents', () => {
    expect(amountProblem('2')).toBeNull();
    expect(amountProblem('25.50')).toBeNull();
    expect(amountProblem('0.50')).toMatch(/smallest/);
    expect(amountProblem('10001')).toMatch(/up to/);
    expect(amountProblem('1.234')).toMatch(/dollars/);
    expect(amountProblem('1e3')).toMatch(/dollars/);
  });
});
