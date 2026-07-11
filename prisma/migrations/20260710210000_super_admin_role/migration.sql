-- SUPER_ADMIN: the owner tier above ADMIN. Holds everything ADMIN holds
-- plus the supers-only permissions in src/lib/rbac.ts (roles:assign,
-- diagnostics:view). Exactly one is minted by the one-time bootstrap
-- (docs/ADMIN-SETUP.md); after that the bootstrap endpoint answers 410.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction that also
-- uses the new value - apply this file as a single standalone statement.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
