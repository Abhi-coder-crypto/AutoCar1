# Vercel Deployment Guide

This application has been configured to work on Vercel's serverless platform.

## Prerequisites

1. A Vercel account
2. MongoDB Atlas database (or any MongoDB instance accessible from the internet)
3. Your repository connected to Vercel

## Environment Variables

Configure these environment variables in your Vercel project settings:

### Required Variables

- **MONGODB_URI**: Your MongoDB connection string
  - Example: `mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority`
  - Get this from MongoDB Atlas or your MongoDB provider

### Recommended Variables

- **JWT_SECRET**: Secret key for JWT token generation
  - Example: Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - If not set, it will use SESSION_SECRET

- **SESSION_SECRET**: Secret key for session management (fallback)
  - Example: Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - Default: `'autoshop-secret-key-change-in-production'` (not secure for production!)

### Optional Variables

- **NODE_ENV**: Set to `production` (Vercel sets this automatically)

## How to Deploy

### 1. Set Environment Variables

In your Vercel dashboard:
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add each variable listed above
4. Make sure to add them for "Production", "Preview", and "Development" environments

### 2. Deploy

Push to your repository and Vercel will automatically deploy:

```bash
git add .
git commit -m "Configure for Vercel deployment"
git push origin main
```

### 3. Verify Deployment

After deployment:
1. Check the deployment logs for any errors
2. Visit your Vercel URL
3. Try logging in to verify the app works

## Architecture Notes

### Serverless Configuration

- **API Handler**: All requests are handled by `api/index.ts` as a serverless function
- **MongoDB Connection**: Uses connection caching to reuse connections across function invocations
- **Authentication**: Uses JWT tokens (Bearer authentication) which works perfectly with serverless
- **Sessions**: Session support is disabled in serverless mode; authentication relies on JWT tokens
- **Static Files**: The `dist/public/` folder is bundled with the serverless function using `includeFiles`

### Build Process

1. Frontend builds to `dist/public/` (Vite build output)
2. Backend builds to `dist/index.js` (not used in serverless mode)
3. `api/index.ts` is compiled and deployed as a serverless function
4. Static assets from `dist/public/` are included in the function deployment

### Routing

- `/api/*` routes are handled directly by the serverless function
- All other routes are rewritten to `api/index.ts` 
- Static files (JS, CSS, images) are served by Express static middleware from `dist/public/`
- The React SPA is served for all non-API routes

### Key Configuration Files

- **vercel.json**: Configures function timeout (30s) and includes static files
- **api/index.ts**: Serverless handler that sets up Express, routes, and static file serving
- **server/db.ts**: MongoDB connection with global caching for serverless

## Troubleshooting

### Function Crashes

If you see "FUNCTION_INVOCATION_FAILED":
1. Check Vercel logs for specific error messages
2. Verify MONGODB_URI is set correctly
3. Ensure your MongoDB database allows connections from Vercel's IP ranges

### Database Connection Issues

- Make sure your MongoDB instance allows connections from `0.0.0.0/0` (all IPs) or Vercel's IP ranges
- Check that the MONGODB_URI includes the correct database name
- Verify authentication credentials are correct

### Authentication Issues

- Ensure JWT_SECRET or SESSION_SECRET is set
- Check that the frontend is sending the Authorization header with Bearer token
- Verify tokens are being generated correctly in `/api/auth/login`

## Differences from Replit Deployment

| Feature | Replit | Vercel |
|---------|--------|--------|
| Server Type | Long-running Express | Serverless Functions |
| Sessions | MemoryStore (works) | Not available (uses JWT) |
| MongoDB Connection | Single connection | Cached per function |
| Cold Starts | No | Yes (first request slower) |
| Scaling | Single instance | Auto-scales |

## Performance Tips

1. **Database Connection**: The app uses connection caching to minimize cold start impact
2. **Bundle Size**: Consider code splitting if the serverless function is too large
3. **Timeout**: Functions have a 30-second timeout (configured in vercel.json)
4. **Memory**: Vercel automatically allocates memory based on function needs

## Support

If you encounter issues:
1. Check Vercel deployment logs
2. Review MongoDB connection logs
3. Test authentication endpoints first
4. Verify environment variables are set correctly
