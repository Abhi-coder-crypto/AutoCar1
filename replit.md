# Mauli Car World - Car Parts & Service Management System

## Overview
Mauli Car World is a comprehensive full-stack web application for auto repair shops. It efficiently manages car parts inventory, customer relationships, service workflows, employee management, and sales tracking. The system supports multiple user roles (administrators, inventory managers, sales executives, HR managers, and service staff) with tailored views and permissions, providing a professional dashboard for all automotive service business operations. The business vision is to streamline operations for auto repair shops, enhancing efficiency and customer satisfaction, with market potential in small to medium-sized repair businesses.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The frontend is built with **React (18+)** and **Vite**, utilizing **TypeScript** for type safety and **Wouter** for client-side routing. **TanStack Query** manages server state. The UI uses **Shadcn/ui** components based on **Radix UI primitives** and styled with **Tailwind CSS**, following a dark-mode-first, information-dense design. It includes a custom theme provider, custom hooks, and maintains a consistent aesthetic with thick orange borders and gradient backgrounds for cards and vehicle images. Features include WhatsApp-style image cropping for employee photos and enhanced customer details displays.

### Backend Architecture
The backend is an **Express.js** RESTful API server, written in **TypeScript**. It features a middleware-based request processing system for logging, error handling, and JSON parsing. API endpoints follow resource-based patterns for CRUD operations. An inactivity timeout system automatically logs out non-admin users after 30 minutes.

### Database Layer
The application exclusively uses **MongoDB** with **Mongoose ODM**. A singleton pattern manages the connection. Schema designs incorporate validation, hooks, virtual fields, and reference-based relationships.

### Data Models & Schemas
Core entities include Product (with multi-image support, variants, barcode, compatibility, warranty, and detailed inventory tracking), RegistrationCustomer (with referral source tracking and auto-generated IDs), RegistrationVehicle (linked to customers, with **auto-generated unique Vehicle IDs** in format VEH001, VEH002, etc., plus variant (Top/Base), color, and dynamic fields like selected parts and chassis numbers), Employee (with auto-generated IDs, photo upload, status management, and performance logs), ServiceVisit (with before/after image support), Order, InventoryTransaction, ProductReturn, Supplier, PurchaseOrder, Attendance, Leave, Task, CommunicationLog, and Feedback. **Zod** is used for validation schemas for `RegistrationCustomer` and `RegistrationVehicle`. The `isNew` field was renamed to `isNewVehicle` to resolve Mongoose warnings.

**Vehicle ID System**: Each vehicle receives a unique, auto-generated Vehicle ID (VEH001, VEH002, etc.) using a Counter-based sequence. This ID serves as the primary reference for all service records, invoices, and warranty tracking. Vehicle records also include variant (Top/Base) and color fields for comprehensive vehicle tracking.

### Authentication & Authorization
The system uses **dual authentication**: session-based authentication (for development) and **JWT token-based authentication** (for production/serverless). Password hashing is handled by **bcryptjs**. **Role-Based Access Control (RBAC)** defines five distinct roles: Admin, Inventory Manager, Sales Executive, HR Manager, and Service Staff, each with granular permissions. Two-step OTP verification is implemented for login.

### Deployment Architecture
The application supports deployment to both **Replit** (traditional server) and **Vercel** (serverless):
- **Replit**: Uses session-based auth with MemoryStore, long-running Express server on port 5000
- **Vercel**: Uses JWT token authentication, serverless functions via `api/index.ts` with MongoDB connection caching
- Static files are bundled with the serverless function using `includeFiles` configuration
- Environment variables required for Vercel: `MONGODB_URI`, `JWT_SECRET` (or `SESSION_SECRET`)

### UI/UX Decisions
Global card styling features `border-2 border-orange-300 dark:border-orange-700`. Vehicle images use `border-2 border-orange-300 dark:border-orange-700`, `object-contain`, and gradient backgrounds. Responsive layouts are used for dashboards. Forms feature conditional fields and dynamic dropdowns. Image uploads have live previews, base64 encoding, and validation. Employee photo sizes are increased, and documents are viewed in a dedicated viewer.

### Multi-Vehicle Customer Registration
The customer registration flow supports adding multiple vehicles per customer. After entering customer information and OTP verification, users can add vehicles one at a time. The form displays the count of registered vehicles and provides options to either "Add Another Vehicle" or "Complete Registration" (shown after at least one vehicle is added). The customer dashboard displays a "+X more" badge on customer cards when they have multiple vehicles, showing additional vehicles beyond the primary one.

### Complete Activity Tracking System
A comprehensive activity logging system tracks all user actions (CRUD operations on Employees, Products, Orders, Service Visits, Suppliers, Purchase Orders, and user login/logout) with an `ActivityLog` model. An `ActivityFeed` component in the admin dashboard displays real-time activities with role-based badge colors, action-based indicators, resource icons, and "time ago" formatting. API endpoints for fetching and creating activity logs are provided.

## External Dependencies

-   **Database**: MongoDB (via Mongoose)
-   **UI Components**: Radix UI, Shadcn/ui, Tailwind CSS, Lucide React
-   **State & Data Management**: TanStack Query, React Hook Form, Zod
-   **Date & Time**: date-fns
-   **Development Tools**: Vite, esbuild, TypeScript
-   **Deployment**: Vercel
-   **Security**: bcryptjs