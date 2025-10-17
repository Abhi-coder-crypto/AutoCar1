# Vercel Deployment Guide

This guide will help you deploy the Mauli Car World application to Vercel.

## Prerequisites

- A Vercel account (sign up at https://vercel.com)
- A MongoDB database (MongoDB Atlas recommended: https://www.mongodb.com/cloud/atlas)
- Your project pushed to a Git repository (GitHub, GitLab, or Bitbucket)

## Environment Variables

Before deploying, you need to set up the following environment variables in your Vercel project settings:

### Required Environment Variables

**IMPORTANT**: These environment variables MUST be set in Vercel. The application will not start without them.

1. **MONGODB_URI** (Required)
   - Your MongoDB connection string
   - Example: `mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority`
   - Get this from your MongoDB Atlas dashboard

2. **JWT_SECRET** (Required)
   - A secure random string for JWT token signing
   - Generate using: `openssl rand -base64 32`
   - Must be at least 32 characters long

3. **SESSION_SECRET** (Optional but recommended)
   - A secure random string for session encryption (used as JWT_SECRET fallback)
   - Generate using: `openssl rand -base64 32`
   - If not set, JWT_SECRET will be used

4. **NODE_ENV** (Automatic)
   - Set to `production` for production deployments
   - Vercel sets this automatically

## Deployment Steps

### Option 1: Deploy via Vercel Dashboard (Recommended)

1. **Push your code to Git**
   ```bash
   git add .
   git commit -m "Prepare for Vercel deployment"
   git push origin main
   ```

2. **Import Project to Vercel**
   - Go to https://vercel.com/dashboard
   - Click "Add New Project"
   - Import your Git repository
   - Select the repository containing your project

3. **Configure Project**
   - Framework Preset: Select "Other" or leave as detected
   - Root Directory: Leave as default (`.`)
   - Build Command: `npm run build`
   - Output Directory: `dist/public`
   - Install Command: `npm install`

4. **Add Environment Variables**
   - In the project settings, go to "Environment Variables"
   - Add each variable from the list above
   - Make sure to add them for all environments (Production, Preview, Development)

5. **Deploy**
   - Click "Deploy"
   - Wait for the build to complete
   - Your app will be live at `https://your-project-name.vercel.app`

### Option 2: Deploy via Vercel CLI

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Set Environment Variables**
   ```bash
   vercel env add MONGODB_URI
   vercel env add SESSION_SECRET
   vercel env add JWT_SECRET
   ```

4. **Deploy**
   ```bash
   vercel --prod
   ```

## Post-Deployment

### 1. Verify Deployment
- Visit your deployed URL
- Test the login functionality
- Check that all features work correctly

### 2. Set Up Custom Domain (Optional)
- In Vercel dashboard, go to your project settings
- Navigate to "Domains"
- Add your custom domain
- Follow the DNS configuration instructions

### 3. Monitor Your Application
- Use Vercel Analytics to monitor performance
- Check the Vercel logs for any errors
- Set up error monitoring (Sentry, LogRocket, etc.)

## Troubleshooting

### Build Fails
- Check the build logs in Vercel dashboard
- Ensure all dependencies are in `package.json`
- Verify TypeScript compilation works locally: `npm run check`

### Database Connection Issues
- Verify your MongoDB URI is correct
- Ensure MongoDB Atlas allows connections from anywhere (0.0.0.0/0) or add Vercel IPs
- Check that your database user has the correct permissions

### Authentication Not Working
- Verify JWT_SECRET and SESSION_SECRET are set correctly
- Check browser console for errors
- Ensure cookies are being set correctly (check SameSite and Secure attributes)

### API Routes Not Working
- Verify the `vercel.json` configuration is correct
- Check that serverless function timeout is sufficient (max 30s on Pro plan)
- Review the function logs in Vercel dashboard

## Performance Optimization

1. **Enable Edge Caching**
   - Add appropriate cache headers to static assets
   - Use Vercel's Edge Network for faster global delivery

2. **Optimize Database Queries**
   - Add indexes to frequently queried fields
   - Use MongoDB Atlas Performance Advisor

3. **Monitor Cold Starts**
   - Serverless functions may have cold starts
   - Consider using Vercel Pro for faster cold starts

## Security Best Practices

1. **Rotate Secrets Regularly**
   - Change JWT_SECRET and SESSION_SECRET periodically
   - Update them in Vercel environment variables

2. **Use HTTPS Only**
   - Vercel provides HTTPS by default
   - Ensure secure cookies are enabled in production

3. **Implement Rate Limiting**
   - Add rate limiting to prevent abuse
   - Use Vercel's Edge Functions for better performance

4. **Keep Dependencies Updated**
   - Regularly update npm packages
   - Monitor security advisories

## Support

For issues with Vercel deployment:
- Vercel Documentation: https://vercel.com/docs
- Vercel Community: https://github.com/vercel/vercel/discussions

For application-specific issues:
- Check application logs in Vercel dashboard
- Review MongoDB logs in Atlas dashboard
