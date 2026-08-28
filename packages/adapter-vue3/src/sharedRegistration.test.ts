import { describe, expect, it, vi } from 'vitest';
import { SharedRegistrationPool } from './sharedRegistration';

describe('Shared Registration Pool', () => {
  it('共享同一目标的注册并在最后一个使用方释放时注销', () => {
    const pool = new SharedRegistrationPool<object>();
    const target = {};
    const dispose = vi.fn();
    const register = vi.fn(() => dispose);

    const releaseAutomatic = pool.acquire(target, register);
    const releaseDirect = pool.acquire(target, register);

    expect(register).toHaveBeenCalledTimes(1);

    releaseAutomatic();
    expect(dispose).not.toHaveBeenCalled();

    releaseDirect();
    expect(dispose).toHaveBeenCalledTimes(1);

    releaseDirect();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('完全释放后允许同一目标重新注册', () => {
    const pool = new SharedRegistrationPool<object>();
    const target = {};
    const dispose = vi.fn();
    const register = vi.fn(() => dispose);

    pool.acquire(target, register)();
    pool.acquire(target, register)();

    expect(register).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
