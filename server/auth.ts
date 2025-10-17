import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from './models/User';

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET or SESSION_SECRET environment variable must be set');
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createUser(email: string, password: string, name: string, role: string) {
  const passwordHash = await hashPassword(password);
  return User.create({
    email,
    passwordHash,
    name,
    role,
    isActive: true
  });
}

export async function authenticateUser(email: string, password: string) {
  const user = await User.findOne({ email, isActive: true });
  if (!user) {
    return null;
  }
  
  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return null;
  }
  
  return user;
}

export function generateToken(userId: string, userRole: string, userName: string, userEmail: string): string {
  return jwt.sign(
    {
      userId,
      userRole,
      userName,
      userEmail,
      iat: Date.now(),
    },
    JWT_SECRET!,
    { expiresIn: '24h' }
  );
}

export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET!);
  } catch (error) {
    return null;
  }
}

export const ROLE_PERMISSIONS = {
  Admin: {
    products: ['read', 'create', 'update', 'delete'],
    inventory: ['read', 'create', 'update', 'delete'],
    employees: ['read', 'create', 'update', 'delete'],
    customers: ['read', 'create', 'update', 'delete'],
    orders: ['read', 'create', 'update', 'delete'],
    reports: ['read'],
    notifications: ['read', 'update'],
    users: ['read', 'create', 'update', 'delete'],
    suppliers: ['read', 'create', 'update', 'delete'],
    purchaseOrders: ['read', 'create', 'update', 'delete'],
    attendance: ['read', 'create', 'update', 'delete'],
    leaves: ['read', 'create', 'update', 'delete'],
    tasks: ['read', 'create', 'update', 'delete'],
    communications: ['read', 'create', 'update', 'delete'],
    feedbacks: ['read', 'create', 'update', 'delete'],
  },
  'Inventory Manager': {
    products: ['read', 'create', 'update', 'delete'],
    inventory: ['read', 'create', 'update', 'delete'],
  },
  'Sales Executive': {
    customers: ['read', 'create', 'update', 'delete'],
    orders: ['read', 'create', 'update', 'delete'],
  },
  'HR Manager': {
    employees: ['read', 'create', 'update', 'delete'],
    attendance: ['read', 'create', 'update', 'delete'],
  },
  'Service Staff': {
    customers: ['read'],
    orders: ['read', 'update'],
  },
};

export function hasPermission(userRole: string, resource: string, action: string): boolean {
  const permissions = ROLE_PERMISSIONS[userRole as keyof typeof ROLE_PERMISSIONS];
  if (!permissions) return false;
  
  const resourcePermissions = permissions[resource as keyof typeof permissions] as string[] | undefined;
  if (!resourcePermissions) return false;
  
  return resourcePermissions.includes(action);
}
