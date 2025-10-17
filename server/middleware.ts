import { Request, Response, NextFunction } from 'express';
import { hasPermission, verifyToken } from './auth';

function getUserFromRequest(req: Request): any {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (decoded) {
      return {
        id: decoded.userId,
        role: decoded.userRole,
        name: decoded.userName,
        email: decoded.userEmail,
        tokenIat: decoded.iat,
      };
    }
  }
  
  const session = (req as any).session;
  if (session?.userId) {
    return {
      id: session.userId,
      role: session.userRole,
      name: session.userName,
      email: session.userEmail,
    };
  }
  
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  (req as any).user = user;
  next();
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(user.role || '')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    (req as any).user = user;
    next();
  };
}

export function requirePermission(resource: string, action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!hasPermission(user.role, resource, action)) {
      return res.status(403).json({ error: 'Insufficient permissions for this action' });
    }
    
    (req as any).user = user;
    next();
  };
}

export function attachUser(req: Request, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (user) {
    (req as any).user = user;
  }
  next();
}

export function checkInactivityTimeout(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (session?.userId) {
    const userRole = session.userRole;
    const now = Date.now();
    const INACTIVITY_TIMEOUT = 30 * 60 * 1000;
    
    if (userRole !== 'Admin') {
      if (session.lastActivity) {
        const inactiveTime = now - session.lastActivity;
        
        if (inactiveTime > INACTIVITY_TIMEOUT) {
          session.destroy((err: any) => {
            if (err) {
              console.error('Error destroying session:', err);
            }
          });
          return res.status(401).json({ 
            error: 'Session expired due to inactivity',
            code: 'INACTIVITY_TIMEOUT'
          });
        }
      }
      
      session.lastActivity = now;
    }
  }
  
  next();
}
