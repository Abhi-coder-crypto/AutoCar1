import type { Express } from "express";
import { createServer, type Server } from "http";
import { connectDB } from "./db";
import { Product } from "./models/Product";
import { Employee } from "./models/Employee";
import { ServiceVisit } from "./models/ServiceVisit";
import { Order } from "./models/Order";
import { InventoryTransaction } from "./models/InventoryTransaction";
import { ProductReturn } from "./models/ProductReturn";
import { Notification } from "./models/Notification";
import { Supplier } from "./models/Supplier";
import { PurchaseOrder } from "./models/PurchaseOrder";
import { Attendance } from "./models/Attendance";
import { Leave } from "./models/Leave";
import { Task } from "./models/Task";
import { CommunicationLog } from "./models/CommunicationLog";
import { Feedback } from "./models/Feedback";
import { ActivityLog } from "./models/ActivityLog";
import { PerformanceLog } from "./models/PerformanceLog";
import { getNextSequence } from "./models/Counter";
import { checkAndNotifyLowStock, notifyNewOrder, notifyServiceVisitStatus, notifyPaymentOverdue, notifyPaymentDue } from "./utils/notifications";
import { logActivity } from "./utils/activityLogger";
import { User } from "./models/User";
import { authenticateUser, createUser, ROLE_PERMISSIONS, generateToken } from "./auth";
import { requireAuth, requireRole, attachUser, requirePermission } from "./middleware";
import { insertCustomerSchema, insertVehicleSchema } from "./schemas";
import { RegistrationCustomer } from "./models/RegistrationCustomer";
import { RegistrationVehicle } from "./models/RegistrationVehicle";

export async function registerRoutes(app: Express): Promise<Server> {
  await connectDB();
  
  // Auto-migrate: Add vehicleId to existing vehicles without it
  try {
    const vehiclesWithoutId = await RegistrationVehicle.find({ 
      $or: [
        { vehicleId: { $exists: false } },
        { vehicleId: null },
        { vehicleId: '' }
      ]
    });
    
    if (vehiclesWithoutId.length > 0) {
      console.log(`🔄 Migrating ${vehiclesWithoutId.length} vehicles to add Vehicle IDs...`);
      for (const vehicle of vehiclesWithoutId) {
        const vehicleSeq = await getNextSequence('vehicle');
        const vehicleId = `VEH${String(vehicleSeq).padStart(3, '0')}`;
        
        await RegistrationVehicle.updateOne(
          { _id: vehicle._id },
          { $set: { vehicleId } }
        );
      }
      console.log(`✅ Migration complete: Added Vehicle IDs to ${vehiclesWithoutId.length} vehicles`);
    }
  } catch (error) {
    console.error('❌ Vehicle ID migration error:', error);
  }
  
  app.use(attachUser);

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      
      const user = await authenticateUser(email, password);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      const token = generateToken(
        user._id.toString(),
        user.role,
        user.name,
        user.email
      );
      
      if ((req as any).session) {
        (req as any).session.userId = user._id.toString();
        (req as any).session.userRole = user.role;
        (req as any).session.userName = user.name;
        (req as any).session.userEmail = user.email;
        
        if (user.role !== 'Admin') {
          (req as any).session.lastActivity = Date.now();
        }
      }
      
      await logActivity({
        userId: user._id.toString(),
        userName: user.name,
        userRole: user.role,
        action: 'login',
        resource: 'user',
        description: `${user.name} logged in`,
        ipAddress: req.ip,
      });
      
      res.json({
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        token,
      });
    } catch (error) {
      res.status(400).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    (req as any).session.destroy((err: any) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const user = await User.findById(userId).select('-passwordHash');
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json({
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS] || {},
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // User management endpoints (Admin only)
  app.post("/api/users", requireAuth, requireRole('Admin'), async (req, res) => {
    try {
      const { email, password, name, role } = req.body;
      
      if (!email || !password || !name || !role) {
        return res.status(400).json({ error: "All fields are required" });
      }
      
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: "User already exists" });
      }
      
      const user = await createUser(email, password, name, role);
      
      res.json({
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
      });
    } catch (error) {
      res.status(400).json({ error: "Failed to create user" });
    }
  });

  app.get("/api/users", requireAuth, requireRole('Admin'), async (req, res) => {
    try {
      const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.patch("/api/users/:id", requireAuth, requireRole('Admin'), async (req, res) => {
    try {
      const { name, role, isActive } = req.body;
      const user = await User.findByIdAndUpdate(
        req.params.id,
        { name, role, isActive },
        { new: true }
      ).select('-passwordHash');
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      res.status(400).json({ error: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", requireAuth, requireRole('Admin'), async (req, res) => {
    try {
      const userId = req.params.id;
      
      // Prevent admins from deleting themselves
      if (userId === (req as any).session.userId) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }
      
      const user = await User.findByIdAndDelete(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to delete user" });
    }
  });

  // Products endpoints with permission checks
  app.get("/api/products", requireAuth, requirePermission('products', 'read'), async (req, res) => {
    try {
      const products = await Product.find().sort({ createdAt: -1 });
      res.json(products);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  app.post("/api/products", requireAuth, requirePermission('products', 'create'), async (req, res) => {
    try {
      const product = await Product.create(req.body);
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'create',
        resource: 'product',
        resourceId: product._id.toString(),
        description: `Created product: ${product.name}`,
        details: { category: product.category, brand: product.brand },
        ipAddress: req.ip,
      });
      
      res.json(product);
    } catch (error) {
      res.status(400).json({ error: "Failed to create product" });
    }
  });

  app.patch("/api/products/:id", requireAuth, requirePermission('products', 'update'), async (req, res) => {
    try {
      const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'update',
        resource: 'product',
        resourceId: product._id.toString(),
        description: `Updated product: ${product.name}`,
        details: req.body,
        ipAddress: req.ip,
      });
      
      res.json(product);
    } catch (error) {
      res.status(400).json({ error: "Failed to update product" });
    }
  });

  app.delete("/api/products/:id", requireAuth, requirePermission('products', 'delete'), async (req, res) => {
    try {
      const product = await Product.findByIdAndDelete(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'delete',
        resource: 'product',
        resourceId: product._id.toString(),
        description: `Deleted product: ${product.name}`,
        ipAddress: req.ip,
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to delete product" });
    }
  });

  // Employees endpoints with permission checks
  app.get("/api/employees", requireAuth, requirePermission('employees', 'read'), async (req, res) => {
    try {
      const employees = await Employee.find().sort({ createdAt: -1 });
      res.json(employees);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch employees" });
    }
  });

  app.post("/api/employees", requireAuth, requirePermission('employees', 'create'), async (req, res) => {
    try {
      const sequence = await getNextSequence('employee_id');
      const employeeId = `EMP${String(sequence).padStart(3, '0')}`;
      
      const employee = await Employee.create({
        ...req.body,
        employeeId
      });
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'create',
        resource: 'employee',
        resourceId: employee._id.toString(),
        description: `Created employee: ${employee.name} (${employeeId})`,
        details: { role: employee.role, email: employee.email, employeeId },
        ipAddress: req.ip,
      });
      
      res.json(employee);
    } catch (error) {
      res.status(400).json({ error: "Failed to create employee" });
    }
  });

  app.patch("/api/employees/:id", requireAuth, requirePermission('employees', 'update'), async (req, res) => {
    try {
      const employee = await Employee.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'update',
        resource: 'employee',
        resourceId: employee._id.toString(),
        description: `Updated employee: ${employee.name}`,
        details: { role: employee.role },
        ipAddress: req.ip,
      });
      
      res.json(employee);
    } catch (error) {
      res.status(400).json({ error: "Failed to update employee" });
    }
  });

  app.delete("/api/employees/:id", requireAuth, requirePermission('employees', 'delete'), async (req, res) => {
    try {
      const employee = await Employee.findByIdAndDelete(req.params.id);
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'delete',
        resource: 'employee',
        resourceId: employee._id.toString(),
        description: `Deleted employee: ${employee.name}`,
        ipAddress: req.ip,
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to delete employee" });
    }
  });

  // Performance Log endpoints
  app.get("/api/performance-logs", requireAuth, requirePermission('employees', 'read'), async (req, res) => {
    try {
      const { employeeId, month, year } = req.query;
      const filter: any = {};
      
      if (employeeId) filter.employeeId = employeeId;
      if (month) filter.month = parseInt(month as string);
      if (year) filter.year = parseInt(year as string);
      
      const logs = await PerformanceLog.find(filter)
        .populate('employeeId')
        .sort({ year: -1, month: -1 });
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch performance logs" });
    }
  });

  app.post("/api/performance-logs/generate", requireAuth, requirePermission('employees', 'update'), async (req, res) => {
    try {
      const { month, year } = req.body;
      const targetMonth = month || new Date().getMonth() + 1;
      const targetYear = year || new Date().getFullYear();
      
      const employees = await Employee.find({ isActive: true });
      const logs = [];
      
      for (const employee of employees) {
        const existingLog = await PerformanceLog.findOne({
          employeeId: employee._id,
          month: targetMonth,
          year: targetYear
        });
        
        if (existingLog) continue;
        
        const startDate = new Date(targetYear, targetMonth - 1, 1);
        const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);
        
        const salesData = await Order.aggregate([
          { 
            $match: { 
              salespersonId: employee._id,
              createdAt: { $gte: startDate, $lte: endDate }
            } 
          },
          {
            $group: {
              _id: null,
              totalSales: { $sum: '$total' },
              orderCount: { $sum: 1 },
              avgOrderValue: { $avg: '$total' }
            }
          }
        ]);
        
        const attendanceData = await Attendance.aggregate([
          {
            $match: {
              employeeId: employee._id,
              date: { $gte: startDate, $lte: endDate }
            }
          },
          {
            $group: {
              _id: null,
              totalDays: { $sum: 1 },
              presentDays: { 
                $sum: { 
                  $cond: [{ $eq: ['$status', 'Present'] }, 1, 0] 
                } 
              }
            }
          }
        ]);
        
        const tasksData = await Task.countDocuments({
          assignedTo: employee._id,
          status: 'Completed',
          updatedAt: { $gte: startDate, $lte: endDate }
        });
        
        const sales = salesData[0] || { totalSales: 0, orderCount: 0, avgOrderValue: 0 };
        const attendance = attendanceData[0] || { totalDays: 0, presentDays: 0 };
        const attendanceRate = attendance.totalDays > 0 ? (attendance.presentDays / attendance.totalDays) * 100 : 0;
        
        const performanceScore = Math.round(
          (sales.totalSales / 100000) * 40 +
          attendanceRate * 0.3 +
          (tasksData / 10) * 30
        );
        
        const log = await PerformanceLog.create({
          employeeId: employee._id,
          employeeName: employee.name,
          employeeCode: employee.employeeId,
          month: targetMonth,
          year: targetYear,
          totalSales: sales.totalSales,
          orderCount: sales.orderCount,
          avgOrderValue: sales.avgOrderValue,
          attendanceRate: Math.round(attendanceRate * 100) / 100,
          tasksCompleted: tasksData,
          performanceScore: Math.min(performanceScore, 100),
          createdBy: (req as any).session.userId
        });
        
        logs.push(log);
      }
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'create',
        resource: 'employee',
        description: `Generated ${logs.length} performance logs for ${targetMonth}/${targetYear}`,
        ipAddress: req.ip,
      });
      
      res.json({ 
        message: `Generated ${logs.length} performance logs`,
        logs 
      });
    } catch (error) {
      res.status(400).json({ error: "Failed to generate performance logs" });
    }
  });

  // Service handlers endpoint - accessible to all authenticated users
  app.get("/api/service-handlers", requireAuth, async (req, res) => {
    try {
      const handlers = await Employee.find({
        role: { $in: ['Admin', 'Service Staff'] },
        isActive: true
      }).sort({ name: 1 });
      res.json(handlers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch service handlers" });
    }
  });

  // Service visits - use 'orders' resource for permissions (Service Staff can read/update)
  app.get("/api/service-visits", requireAuth, requirePermission('orders', 'read'), async (req, res) => {
    try {
      const visits = await ServiceVisit.find()
        .populate('customerId')
        .populate('handlerIds')
        .populate('partsUsed.productId')
        .sort({ createdAt: -1 });
      res.json(visits);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch service visits" });
    }
  });

  app.post("/api/service-visits", requireAuth, requirePermission('orders', 'create'), async (req, res) => {
    try {
      const visit = await ServiceVisit.create(req.body);
      await visit.populate('customerId');
      await visit.populate('handlerIds');
      
      // Notify about new service visit
      const customerName = visit.customerId?.name || 'Unknown Customer';
      await notifyServiceVisitStatus(visit, customerName, visit.status);
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'create',
        resource: 'service_visit',
        resourceId: visit._id.toString(),
        description: `Created service visit for ${visit.vehicleReg}`,
        details: { status: visit.status, customerName },
        ipAddress: req.ip,
      });
      
      res.json(visit);
    } catch (error) {
      res.status(400).json({ error: "Failed to create service visit" });
    }
  });

  app.patch("/api/service-visits/:id", requireAuth, requirePermission('orders', 'update'), async (req, res) => {
    try {
      const previousVisit = await ServiceVisit.findById(req.params.id).populate('customerId');
      
      // Validate base64 images if present (format and size check - limit to 15MB per image)
      const validateImages = (images: string[]) => {
        if (!images || !Array.isArray(images)) return true;
        const dataUriRegex = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/;
        const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
        
        return images.every(img => {
          if (!img) return true;
          
          // Check data URI format
          if (!dataUriRegex.test(img)) return false;
          
          // Extract and validate base64 content
          const base64Content = img.replace(dataUriRegex, '');
          if (!base64Regex.test(base64Content)) return false;
          
          // Check size (15MB limit)
          const sizeInMB = (base64Content.length * 0.75) / (1024 * 1024);
          return sizeInMB <= 15;
        });
      };

      if (req.body.beforeImages && !validateImages(req.body.beforeImages)) {
        return res.status(400).json({ error: "Invalid before images: must be valid base64 image data (PNG, JPEG, GIF, WebP) under 15MB per image" });
      }
      if (req.body.afterImages && !validateImages(req.body.afterImages)) {
        return res.status(400).json({ error: "Invalid after images: must be valid base64 image data (PNG, JPEG, GIF, WebP) under 15MB per image" });
      }

      const visit = await ServiceVisit.findByIdAndUpdate(req.params.id, req.body, { new: true })
        .populate('customerId')
        .populate('handlerIds');
      if (!visit) {
        return res.status(404).json({ error: "Service visit not found" });
      }
      
      // Update customer loyalty when visit is completed
      if (req.body.status === 'completed' && previousVisit?.status !== 'completed' && visit.customerId) {
        const customer = await RegistrationCustomer.findById(visit.customerId._id);
        if (customer) {
          customer.visitCount += 1;
          customer.totalSpent += visit.totalAmount || 0;
          customer.calculateLoyaltyTier();
          await customer.save();
        }
      }
      
      // Notify about service visit status change
      if (req.body.status && previousVisit && req.body.status !== previousVisit.status) {
        const customerName = visit.customerId?.name || 'Unknown Customer';
        await notifyServiceVisitStatus(visit, customerName, req.body.status);
      }
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'update',
        resource: 'service_visit',
        resourceId: visit._id.toString(),
        description: `Updated service visit for ${visit.vehicleReg}`,
        details: { status: visit.status },
        ipAddress: req.ip,
      });
      
      res.json(visit);
    } catch (error) {
      res.status(400).json({ error: "Failed to update service visit" });
    }
  });

  app.delete("/api/service-visits/:id", requireAuth, requirePermission('orders', 'delete'), async (req, res) => {
    try {
      const visit = await ServiceVisit.findByIdAndDelete(req.params.id);
      if (!visit) {
        return res.status(404).json({ error: "Service visit not found" });
      }
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'delete',
        resource: 'service_visit',
        resourceId: visit._id.toString(),
        description: `Deleted service visit for ${visit.vehicleReg}`,
        ipAddress: req.ip,
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to delete service visit" });
    }
  });

  // Orders endpoints with permission checks
  app.get("/api/orders", requireAuth, requirePermission('orders', 'read'), async (req, res) => {
    try {
      const orders = await Order.find()
        .populate('customerId')
        .populate('items.productId')
        .populate('salespersonId')
        .sort({ createdAt: -1 });
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  app.post("/api/orders", requireAuth, requirePermission('orders', 'create'), async (req, res) => {
    try {
      const orderData = req.body;
      const order = await Order.create(orderData);
      
      for (const item of req.body.items) {
        const updatedProduct = await Product.findByIdAndUpdate(
          item.productId,
          { $inc: { stockQty: -item.quantity } },
          { new: true }
        );
        
        await InventoryTransaction.create({
          productId: item.productId,
          type: 'OUT',
          quantity: item.quantity,
          reason: `Order ${order.invoiceNumber}`,
        });
        
        // Check for low stock after order
        if (updatedProduct) {
          await checkAndNotifyLowStock(updatedProduct);
        }
      }
      
      await order.populate('customerId');
      await order.populate('items.productId');
      
      // Notify about new order
      const customerName = order.customerId?.name || 'Unknown Customer';
      await notifyNewOrder(order, customerName);
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'create',
        resource: 'order',
        resourceId: order._id.toString(),
        description: `Created order ${order.invoiceNumber} for ${customerName}`,
        details: { total: order.total, itemCount: order.items.length },
        ipAddress: req.ip,
      });
      
      res.json(order);
    } catch (error) {
      res.status(400).json({ error: "Failed to create order" });
    }
  });

  app.patch("/api/orders/:id", requireAuth, requirePermission('orders', 'update'), async (req, res) => {
    try {
      const previousOrder = await Order.findById(req.params.id).populate('customerId');
      const order = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true })
        .populate('customerId')
        .populate('items.productId')
        .populate('salespersonId');
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      // Notify about payment status changes
      if (req.body.paymentStatus && previousOrder && req.body.paymentStatus !== previousOrder.paymentStatus) {
        const customerName = order.customerId?.name || 'Unknown Customer';
        if (req.body.paymentStatus === 'due') {
          await notifyPaymentDue(order, customerName);
        }
      }
      
      const customerName = order.customerId?.name || 'Unknown Customer';
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'update',
        resource: 'order',
        resourceId: order._id.toString(),
        description: `Updated order ${order.invoiceNumber} for ${customerName}`,
        details: { paymentStatus: order.paymentStatus, deliveryStatus: order.deliveryStatus },
        ipAddress: req.ip,
      });
      
      res.json(order);
    } catch (error) {
      res.status(400).json({ error: "Failed to update order" });
    }
  });

  app.delete("/api/orders/:id", requireAuth, requirePermission('orders', 'delete'), async (req, res) => {
    try {
      const order = await Order.findById(req.params.id).populate('customerId');
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      await Order.findByIdAndDelete(req.params.id);
      
      const customerName = order.customerId?.name || 'Unknown Customer';
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'delete',
        resource: 'order',
        resourceId: order._id.toString(),
        description: `Deleted order ${order.invoiceNumber} for ${customerName}`,
        ipAddress: req.ip,
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to delete order" });
    }
  });

  // Inventory transactions with permission checks
  app.get("/api/inventory-transactions", requireAuth, requirePermission('inventory', 'read'), async (req, res) => {
    try {
      const transactions = await InventoryTransaction.find()
        .populate('productId')
        .populate('userId')
        .populate('supplierId')
        .populate('purchaseOrderId')
        .sort({ date: -1 });
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  app.post("/api/inventory-transactions", requireAuth, requirePermission('inventory', 'create'), async (req, res) => {
    try {
      const product = await Product.findById(req.body.productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      const previousStock = product.stockQty;
      let multiplier = 1;
      
      if (req.body.type === 'IN' || req.body.type === 'RETURN') {
        multiplier = 1;
      } else if (req.body.type === 'OUT') {
        multiplier = -1;
      } else if (req.body.type === 'ADJUSTMENT') {
        multiplier = 0; // For adjustments, quantity is absolute
      }
      
      const newStock = req.body.type === 'ADJUSTMENT' 
        ? req.body.quantity 
        : previousStock + (multiplier * req.body.quantity);
      
      const transactionData = {
        ...req.body,
        userId: (req as any).session.userId,
        previousStock,
        newStock,
      };
      
      const transaction = await InventoryTransaction.create(transactionData);
      
      const updatedProduct = await Product.findByIdAndUpdate(
        req.body.productId,
        { stockQty: newStock },
        { new: true }
      );
      
      // Check for low stock and create notification
      if (updatedProduct && (req.body.type === 'OUT' || req.body.type === 'ADJUSTMENT')) {
        await checkAndNotifyLowStock(updatedProduct);
      }
      
      await transaction.populate(['productId', 'userId', 'supplierId', 'purchaseOrderId']);
      res.json(transaction);
    } catch (error) {
      res.status(400).json({ error: "Failed to create transaction" });
    }
  });

  // Low stock alerts
  app.get("/api/products/low-stock", requireAuth, requirePermission('products', 'read'), async (req, res) => {
    try {
      const lowStockProducts = await Product.find({
        $expr: { $lte: ['$stockQty', '$minStockLevel'] }
      }).sort({ stockQty: 1 });
      res.json(lowStockProducts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch low stock products" });
    }
  });

  // Product search by barcode/QR
  app.get("/api/products/barcode/:barcode", requireAuth, requirePermission('products', 'read'), async (req, res) => {
    try {
      const product = await Product.findOne({ barcode: req.params.barcode });
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch product" });
    }
  });

  // Product returns with permission checks
  app.get("/api/product-returns", requireAuth, requirePermission('inventory', 'read'), async (req, res) => {
    try {
      const returns = await ProductReturn.find()
        .populate('productId')
        .populate('customerId')
        .populate('orderId')
        .populate('processedBy')
        .sort({ returnDate: -1 });
      res.json(returns);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch product returns" });
    }
  });

  app.post("/api/product-returns", requireAuth, requirePermission('inventory', 'create'), async (req, res) => {
    try {
      const returnData = {
        ...req.body,
        returnDate: new Date(),
      };
      const productReturn = await ProductReturn.create(returnData);
      await productReturn.populate(['productId', 'customerId', 'orderId']);
      res.json(productReturn);
    } catch (error) {
      res.status(400).json({ error: "Failed to create product return" });
    }
  });

  app.patch("/api/product-returns/:id", requireAuth, requirePermission('inventory', 'update'), async (req, res) => {
    try {
      const { status, refundAmount, restockable, notes } = req.body;
      const updateData: any = { status, refundAmount, restockable, notes };
      
      if (status === 'processed') {
        updateData.processedBy = (req as any).session.userId;
        updateData.processedDate = new Date();
        
        // If approved and restockable, create inventory transaction
        if (restockable) {
          const productReturn = await ProductReturn.findById(req.params.id);
          if (productReturn) {
            await InventoryTransaction.create({
              productId: productReturn.productId,
              type: 'RETURN',
              quantity: productReturn.quantity,
              reason: `Product return: ${productReturn.reason}`,
              userId: (req as any).session.userId,
              returnId: productReturn._id,
              date: new Date(),
            });
            
            await Product.findByIdAndUpdate(
              productReturn.productId,
              { $inc: { stockQty: productReturn.quantity } }
            );
          }
        }
      }
      
      const updatedReturn = await ProductReturn.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      ).populate(['productId', 'customerId', 'orderId', 'processedBy']);
      
      if (!updatedReturn) {
        return res.status(404).json({ error: "Product return not found" });
      }
      
      res.json(updatedReturn);
    } catch (error) {
      res.status(400).json({ error: "Failed to update product return" });
    }
  });

  // Notifications with permission checks
  app.get("/api/notifications", requireAuth, requirePermission('notifications', 'read'), async (req, res) => {
    try {
      const notifications = await Notification.find().sort({ createdAt: -1 }).limit(50);
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  app.patch("/api/notifications/:id/read", requireAuth, requirePermission('notifications', 'update'), async (req, res) => {
    try {
      const notification = await Notification.findByIdAndUpdate(
        req.params.id,
        { read: true },
        { new: true }
      );
      if (!notification) {
        return res.status(404).json({ error: "Notification not found" });
      }
      res.json(notification);
    } catch (error) {
      res.status(400).json({ error: "Failed to update notification" });
    }
  });

  app.patch("/api/notifications/mark-all-read", requireAuth, requirePermission('notifications', 'update'), async (req, res) => {
    try {
      await Notification.updateMany({ read: false }, { read: true });
      res.json({ success: true, message: "All notifications marked as read" });
    } catch (error) {
      res.status(400).json({ error: "Failed to mark all notifications as read" });
    }
  });

  app.post("/api/notifications/create-test", requireAuth, requirePermission('notifications', 'create'), async (req, res) => {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ error: "Test endpoint only available in development" });
    }
    
    try {
      const testNotifications = [
        {
          message: "Low stock alert: Brake Pads Set (12 units remaining)",
          type: "low_stock",
          read: false,
        },
        {
          message: "New order received from Rajesh Kumar - Order #ORD-2024-001",
          type: "new_order",
          read: false,
        },
        {
          message: "Payment overdue: Invoice #INV-2024-045 (5 days)",
          type: "payment_due",
          read: false,
        },
      ];
      
      const created = await Notification.insertMany(testNotifications);
      res.json({ success: true, count: created.length, notifications: created });
    } catch (error) {
      res.status(400).json({ error: "Failed to create test notifications" });
    }
  });

  app.post("/api/notifications/check-overdue-payments", requireAuth, requirePermission('notifications', 'create'), async (req, res) => {
    try {
      const overdueThresholdDays = 7; // Consider payments overdue after 7 days
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - overdueThresholdDays);
      
      // Find orders with payment status 'due' or 'partial' created before threshold date
      const overdueOrders = await Order.find({
        paymentStatus: { $in: ['due', 'partial'] },
        createdAt: { $lt: thresholdDate }
      }).populate('customerId');
      
      let notificationsCreated = 0;
      
      for (const order of overdueOrders) {
        const orderAge = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        const daysOverdue = Math.max(orderAge - overdueThresholdDays, 1);
        const customerName = order.customerId?.name || order.customerName || 'Unknown Customer';
        
        // Check if notification already exists for this order
        const existingNotification = await Notification.findOne({
          relatedId: order._id,
          type: 'payment_due',
          message: { $regex: 'overdue' }
        });
        
        if (!existingNotification) {
          await notifyPaymentOverdue(order, customerName, daysOverdue);
          notificationsCreated++;
        }
      }
      
      res.json({ 
        success: true, 
        checked: overdueOrders.length, 
        notificationsCreated,
        message: `Checked ${overdueOrders.length} overdue orders, created ${notificationsCreated} new notifications`
      });
    } catch (error) {
      res.status(400).json({ error: "Failed to check overdue payments" });
    }
  });

  // Dashboard stats - role-based analytics aligned with ROLE_PERMISSIONS
  app.get("/api/dashboard-stats", requireAuth, async (req, res) => {
    try {
      const userRole = (req as any).session.userRole;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const stats: any = {};
      const permissions: any = ROLE_PERMISSIONS[userRole as keyof typeof ROLE_PERMISSIONS] || {};
      
      // Admin sees everything (has permissions for all resources)
      if (userRole === 'Admin') {
        const todayOrders = await Order.find({ createdAt: { $gte: today } });
        stats.todaySales = todayOrders.reduce((sum, order) => sum + order.total, 0);
        stats.activeServices = await ServiceVisit.countDocuments({ 
          status: { $in: ['inquired', 'working', 'waiting'] } 
        });
        stats.totalCustomers = await RegistrationCustomer.countDocuments();
        stats.lowStockProducts = await Product.find({
          $expr: { $lte: ['$stockQty', '$minStockLevel'] }
        }).limit(5);
        stats.totalEmployees = await Employee.countDocuments();
        stats.totalProducts = await Product.countDocuments();
      }
      
      // Inventory Manager: only products and inventory (per ROLE_PERMISSIONS)
      else if (userRole === 'Inventory Manager') {
        if (permissions.products?.includes('read')) {
          stats.totalProducts = await Product.countDocuments();
          stats.lowStockProducts = await Product.find({
            $expr: { $lte: ['$stockQty', '$minStockLevel'] }
          }).limit(5);
          stats.totalInventoryValue = await Product.aggregate([
            { $group: { _id: null, total: { $sum: { $multiply: ['$stockQty', '$unitPrice'] } } } }
          ]).then(result => result[0]?.total || 0);
        }
        if (permissions.inventory?.includes('read')) {
          stats.recentTransactions = await InventoryTransaction.countDocuments({ 
            createdAt: { $gte: today } 
          });
        }
      }
      
      // Sales Executive: only customers and orders (per ROLE_PERMISSIONS)
      else if (userRole === 'Sales Executive') {
        if (permissions.orders?.includes('read')) {
          const todayOrders = await Order.find({ createdAt: { $gte: today } });
          stats.todaySales = todayOrders.reduce((sum, order) => sum + order.total, 0);
          stats.activeOrders = await Order.countDocuments({ 
            status: { $in: ['pending', 'processing'] } 
          });
          stats.totalOrders = await Order.countDocuments();
        }
        if (permissions.customers?.includes('read')) {
          stats.totalCustomers = await RegistrationCustomer.countDocuments();
        }
      }
      
      // HR Manager: only employees and attendance (per ROLE_PERMISSIONS)
      else if (userRole === 'HR Manager') {
        if (permissions.employees?.includes('read')) {
          stats.totalEmployees = await Employee.countDocuments();
        }
        if (permissions.attendance?.includes('read')) {
          stats.presentToday = await Attendance.countDocuments({ 
            date: today, 
            status: 'present' 
          });
        }
        if (permissions.leaves?.includes('read')) {
          stats.pendingLeaves = await Leave.countDocuments({ status: 'pending' });
        }
        if (permissions.tasks?.includes('read')) {
          stats.activeTasks = await Task.countDocuments({ 
            status: { $in: ['assigned', 'in-progress'] } 
          });
        }
      }
      
      // Service Staff: customers (read only) and orders (read/update) per ROLE_PERMISSIONS
      else if (userRole === 'Service Staff') {
        if (permissions.customers?.includes('read')) {
          stats.totalCustomers = await RegistrationCustomer.countDocuments();
        }
        if (permissions.orders?.includes('read')) {
          const userId = (req as any).session.userId;
          // Only show their own service visits since they have limited access
          stats.myActiveOrders = await Order.countDocuments({ 
            handlerId: userId,
            status: { $in: ['pending', 'processing'] } 
          });
          stats.myCompletedToday = await Order.countDocuments({
            handlerId: userId,
            status: 'completed',
            updatedAt: { $gte: today }
          });
        }
      }
      
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Suppliers with permission checks
  app.get("/api/suppliers", requireAuth, requirePermission('suppliers', 'read'), async (req, res) => {
    try {
      const suppliers = await Supplier.find().sort({ createdAt: -1 });
      res.json(suppliers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch suppliers" });
    }
  });

  app.post("/api/suppliers", requireAuth, requirePermission('suppliers', 'create'), async (req, res) => {
    try {
      const supplier = await Supplier.create(req.body);
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'create',
        resource: 'supplier',
        resourceId: supplier._id.toString(),
        description: `Created supplier: ${supplier.name}`,
        details: { contact: supplier.contact },
        ipAddress: req.ip,
      });
      
      res.json(supplier);
    } catch (error) {
      res.status(400).json({ error: "Failed to create supplier" });
    }
  });

  app.patch("/api/suppliers/:id", requireAuth, requirePermission('suppliers', 'update'), async (req, res) => {
    try {
      const supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!supplier) {
        return res.status(404).json({ error: "Supplier not found" });
      }
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'update',
        resource: 'supplier',
        resourceId: supplier._id.toString(),
        description: `Updated supplier: ${supplier.name}`,
        ipAddress: req.ip,
      });
      
      res.json(supplier);
    } catch (error) {
      res.status(400).json({ error: "Failed to update supplier" });
    }
  });

  app.delete("/api/suppliers/:id", requireAuth, requirePermission('suppliers', 'delete'), async (req, res) => {
    try {
      const supplier = await Supplier.findByIdAndDelete(req.params.id);
      if (!supplier) {
        return res.status(404).json({ error: "Supplier not found" });
      }
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'delete',
        resource: 'supplier',
        resourceId: supplier._id.toString(),
        description: `Deleted supplier: ${supplier.name}`,
        ipAddress: req.ip,
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to delete supplier" });
    }
  });

  // Purchase orders with permission checks
  app.get("/api/purchase-orders", requireAuth, requirePermission('purchaseOrders', 'read'), async (req, res) => {
    try {
      const orders = await PurchaseOrder.find()
        .populate('supplierId')
        .populate('createdBy')
        .sort({ createdAt: -1 });
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch purchase orders" });
    }
  });

  app.post("/api/purchase-orders", requireAuth, requirePermission('purchaseOrders', 'create'), async (req, res) => {
    try {
      const po = await PurchaseOrder.create(req.body);
      await po.populate('supplierId');
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'create',
        resource: 'purchase_order',
        resourceId: po._id.toString(),
        description: `Created purchase order ${po.poNumber}`,
        details: { supplier: po.supplierId?.name, total: po.totalAmount },
        ipAddress: req.ip,
      });
      
      res.json(po);
    } catch (error) {
      res.status(400).json({ error: "Failed to create purchase order" });
    }
  });

  app.patch("/api/purchase-orders/:id", requireAuth, requirePermission('purchaseOrders', 'update'), async (req, res) => {
    try {
      const po = await PurchaseOrder.findByIdAndUpdate(req.params.id, req.body, { new: true })
        .populate('supplierId');
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }
      
      if (req.body.status === 'received') {
        for (const item of po.items) {
          if (item.productId) {
            await Product.findByIdAndUpdate(
              item.productId,
              { $inc: { stockQty: item.quantity } }
            );
            
            await InventoryTransaction.create({
              productId: item.productId,
              type: 'IN',
              quantity: item.quantity,
              reason: `Purchase Order ${po.poNumber}`,
            });
          }
        }
        po.actualDeliveryDate = new Date();
        await po.save();
      }
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'update',
        resource: 'purchase_order',
        resourceId: po._id.toString(),
        description: `Updated purchase order ${po.poNumber}`,
        details: { status: po.status },
        ipAddress: req.ip,
      });
      
      res.json(po);
    } catch (error) {
      res.status(400).json({ error: "Failed to update purchase order" });
    }
  });

  // Attendance with permission checks
  app.get("/api/attendance", requireAuth, requirePermission('attendance', 'read'), async (req, res) => {
    try {
      const { employeeId, startDate, endDate } = req.query;
      const filter: any = {};
      
      if (employeeId) filter.employeeId = employeeId;
      if (startDate && endDate) {
        filter.date = { 
          $gte: new Date(startDate as string), 
          $lte: new Date(endDate as string) 
        };
      }
      
      const attendance = await Attendance.find(filter)
        .populate('employeeId')
        .sort({ date: -1 });
      res.json(attendance);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch attendance" });
    }
  });

  app.post("/api/attendance", requireAuth, requirePermission('attendance', 'create'), async (req, res) => {
    try {
      const attendance = await Attendance.create(req.body);
      await attendance.populate('employeeId');
      res.json(attendance);
    } catch (error) {
      res.status(400).json({ error: "Failed to create attendance record" });
    }
  });

  app.patch("/api/attendance/:id", requireAuth, requirePermission('attendance', 'update'), async (req, res) => {
    try {
      const attendance = await Attendance.findByIdAndUpdate(req.params.id, req.body, { new: true })
        .populate('employeeId');
      if (!attendance) {
        return res.status(404).json({ error: "Attendance record not found" });
      }
      res.json(attendance);
    } catch (error) {
      res.status(400).json({ error: "Failed to update attendance" });
    }
  });

  // Leaves with permission checks
  app.get("/api/leaves", requireAuth, requirePermission('leaves', 'read'), async (req, res) => {
    try {
      const { employeeId, status } = req.query;
      const filter: any = {};
      
      if (employeeId) filter.employeeId = employeeId;
      if (status) filter.status = status;
      
      const leaves = await Leave.find(filter)
        .populate('employeeId')
        .populate('approvedBy')
        .sort({ createdAt: -1 });
      res.json(leaves);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch leaves" });
    }
  });

  app.post("/api/leaves", requireAuth, requirePermission('leaves', 'create'), async (req, res) => {
    try {
      const leave = await Leave.create(req.body);
      await leave.populate('employeeId');
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'create',
        resource: 'leave',
        resourceId: leave._id.toString(),
        description: `Created leave request for ${leave.employeeId?.name || 'employee'}`,
        details: { type: leave.leaveType, status: leave.status },
        ipAddress: req.ip,
      });
      
      res.json(leave);
    } catch (error) {
      res.status(400).json({ error: "Failed to create leave request" });
    }
  });

  app.patch("/api/leaves/:id", requireAuth, requirePermission('leaves', 'update'), async (req, res) => {
    try {
      const leave = await Leave.findByIdAndUpdate(req.params.id, req.body, { new: true })
        .populate('employeeId')
        .populate('approvedBy');
      if (!leave) {
        return res.status(404).json({ error: "Leave request not found" });
      }
      
      const action = req.body.status === 'approved' ? 'approve' : req.body.status === 'rejected' ? 'reject' : 'update';
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: action,
        resource: 'leave',
        resourceId: leave._id.toString(),
        description: `${action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Updated'} leave request for ${leave.employeeId?.name || 'employee'}`,
        details: { status: leave.status, type: leave.leaveType },
        ipAddress: req.ip,
      });
      
      res.json(leave);
    } catch (error) {
      res.status(400).json({ error: "Failed to update leave request" });
    }
  });

  // Tasks with permission checks
  app.get("/api/tasks", requireAuth, requirePermission('tasks', 'read'), async (req, res) => {
    try {
      const { assignedTo, status } = req.query;
      const filter: any = {};
      
      if (assignedTo) filter.assignedTo = assignedTo;
      if (status) filter.status = status;
      
      const tasks = await Task.find(filter)
        .populate('assignedTo')
        .populate('assignedBy')
        .sort({ createdAt: -1 });
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.post("/api/tasks", requireAuth, requirePermission('tasks', 'create'), async (req, res) => {
    try {
      const task = await Task.create(req.body);
      await task.populate('assignedTo');
      await task.populate('assignedBy');
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'create',
        resource: 'task',
        resourceId: task._id.toString(),
        description: `Created task: ${task.title} for ${task.assignedTo?.name || 'employee'}`,
        details: { priority: task.priority, status: task.status },
        ipAddress: req.ip,
      });
      
      res.json(task);
    } catch (error) {
      res.status(400).json({ error: "Failed to create task" });
    }
  });

  app.patch("/api/tasks/:id", requireAuth, requirePermission('tasks', 'update'), async (req, res) => {
    try {
      const task = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true })
        .populate('assignedTo')
        .populate('assignedBy');
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      
      const action = req.body.status === 'completed' ? 'complete' : 'update';
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: action,
        resource: 'task',
        resourceId: task._id.toString(),
        description: `${action === 'complete' ? 'Completed' : 'Updated'} task: ${task.title}`,
        details: { status: task.status, priority: task.priority },
        ipAddress: req.ip,
      });
      
      res.json(task);
    } catch (error) {
      res.status(400).json({ error: "Failed to update task" });
    }
  });

  // Communication logs with permission checks
  app.get("/api/communication-logs", requireAuth, requirePermission('communications', 'read'), async (req, res) => {
    try {
      const { customerId } = req.query;
      const filter: any = {};
      
      if (customerId) filter.customerId = customerId;
      
      const logs = await CommunicationLog.find(filter)
        .populate('customerId')
        .populate('handledBy')
        .sort({ date: -1 });
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch communication logs" });
    }
  });

  app.post("/api/communication-logs", requireAuth, requirePermission('communications', 'create'), async (req, res) => {
    try {
      const log = await CommunicationLog.create(req.body);
      await log.populate('customerId');
      await log.populate('handledBy');
      res.json(log);
    } catch (error) {
      res.status(400).json({ error: "Failed to create communication log" });
    }
  });

  // Feedbacks with permission checks
  app.get("/api/feedbacks", requireAuth, requirePermission('feedbacks', 'read'), async (req, res) => {
    try {
      const { customerId, type, status } = req.query;
      const filter: any = {};
      
      if (customerId) filter.customerId = customerId;
      if (type) filter.type = type;
      if (status) filter.status = status;
      
      const feedbacks = await Feedback.find(filter)
        .populate('customerId')
        .populate('assignedTo')
        .sort({ createdAt: -1 });
      res.json(feedbacks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch feedbacks" });
    }
  });

  app.post("/api/feedbacks", requireAuth, requirePermission('feedbacks', 'create'), async (req, res) => {
    try {
      const feedback = await Feedback.create(req.body);
      await feedback.populate('customerId');
      res.json(feedback);
    } catch (error) {
      res.status(400).json({ error: "Failed to create feedback" });
    }
  });

  app.patch("/api/feedbacks/:id", requireAuth, requirePermission('feedbacks', 'update'), async (req, res) => {
    try {
      const feedback = await Feedback.findByIdAndUpdate(req.params.id, req.body, { new: true })
        .populate('customerId')
        .populate('assignedTo');
      if (!feedback) {
        return res.status(404).json({ error: "Feedback not found" });
      }
      res.json(feedback);
    } catch (error) {
      res.status(400).json({ error: "Failed to update feedback" });
    }
  });

  // Reports - Admin and HR Manager can access
  app.get("/api/reports/sales", requireAuth, requirePermission('reports', 'read'), async (req, res) => {
    try {
      const { startDate, endDate, period = 'daily' } = req.query;
      const matchStage: any = {};
      
      if (startDate && endDate) {
        matchStage.createdAt = { 
          $gte: new Date(startDate as string), 
          $lte: new Date(endDate as string) 
        };
      }
      
      const groupFormat = period === 'monthly' 
        ? { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }
        : { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } };
      
      const salesReport = await Order.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: groupFormat,
            totalSales: { $sum: '$total' },
            totalOrders: { $sum: 1 },
            avgOrderValue: { $avg: '$total' }
          }
        },
        { $sort: { '_id.year': -1, '_id.month': -1, '_id.day': -1 } }
      ]);
      
      res.json(salesReport);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate sales report" });
    }
  });

  app.get("/api/reports/inventory", requireAuth, requirePermission('reports', 'read'), async (req, res) => {
    try {
      const lowStockProducts = await Product.find({
        $expr: { $lte: ['$stockQty', '$minStockLevel'] }
      }).sort({ stockQty: 1 });
      
      const outOfStockProducts = await Product.find({ stockQty: 0 });
      
      const totalInventoryValue = await Product.aggregate([
        {
          $group: {
            _id: null,
            totalValue: { $sum: { $multiply: ['$stockQty', '$sellingPrice'] } },
            totalItems: { $sum: '$stockQty' }
          }
        }
      ]);
      
      res.json({
        lowStockProducts,
        outOfStockProducts,
        totalInventoryValue: totalInventoryValue[0] || { totalValue: 0, totalItems: 0 }
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate inventory report" });
    }
  });

  app.get("/api/reports/top-products", requireAuth, requirePermission('reports', 'read'), async (req, res) => {
    try {
      const { limit = 10 } = req.query;
      
      const topProducts = await Order.aggregate([
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            totalQuantity: { $sum: '$items.quantity' },
            totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
            orderCount: { $sum: 1 }
          }
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: parseInt(limit as string) },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' }
      ]);
      
      res.json(topProducts);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate top products report" });
    }
  });

  app.get("/api/reports/employee-performance", requireAuth, requirePermission('reports', 'read'), async (req, res) => {
    try {
      const employeeSales = await Order.aggregate([
        { $match: { salespersonId: { $exists: true } } },
        {
          $group: {
            _id: '$salespersonId',
            totalSales: { $sum: '$total' },
            orderCount: { $sum: 1 },
            avgOrderValue: { $avg: '$total' }
          }
        },
        {
          $lookup: {
            from: 'employees',
            localField: '_id',
            foreignField: '_id',
            as: 'employee'
          }
        },
        { $unwind: '$employee' },
        { $sort: { totalSales: -1 } }
      ]);
      
      res.json(employeeSales);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate employee performance report" });
    }
  });

  // New Customer Registration System Routes
  // Customer registration with OTP verification
  app.post("/api/registration/customers", async (req, res) => {
    try {
      const validatedData = insertCustomerSchema.parse(req.body);
      
      // Check if mobile number already exists
      const existing = await RegistrationCustomer.findOne({ mobileNumber: validatedData.mobileNumber });
      if (existing) {
        return res.status(400).json({ error: "Mobile number already registered" });
      }
      
      // Generate reference code
      const stateCodeMap: Record<string, string> = {
        "Andhra Pradesh": "AP", "Arunachal Pradesh": "AR", "Assam": "AS", "Bihar": "BR",
        "Chhattisgarh": "CG", "Goa": "GA", "Gujarat": "GJ", "Haryana": "HR",
        "Himachal Pradesh": "HP", "Jharkhand": "JH", "Karnataka": "KA", "Kerala": "KL",
        "Madhya Pradesh": "MP", "Maharashtra": "MH", "Manipur": "MN", "Meghalaya": "ML",
        "Mizoram": "MZ", "Nagaland": "NL", "Odisha": "OD", "Punjab": "PB",
        "Rajasthan": "RJ", "Sikkim": "SK", "Tamil Nadu": "TN", "Telangana": "TS",
        "Tripura": "TR", "Uttar Pradesh": "UP", "Uttarakhand": "UK", "West Bengal": "WB"
      };
      
      const stateCode = stateCodeMap[validatedData.state] || validatedData.state.substring(0, 2).toUpperCase();
      const customerCount = await RegistrationCustomer.countDocuments();
      const referenceCode = `CUST-${stateCode}-${String(customerCount + 1).padStart(6, '0')}`;
      
      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      const customer = await RegistrationCustomer.create({
        ...validatedData,
        referenceCode,
        isVerified: false,
        otp,
        otpExpiresAt
      });
      
      // TODO: Send OTP via SMS/WhatsApp (implement with actual gateway)
      console.log(`OTP for ${customer.mobileNumber}: ${otp}`);
      
      res.json({ 
        customerId: customer._id.toString(),
        message: "OTP sent successfully",
        // In development, return OTP for testing
        ...(process.env.NODE_ENV === 'development' && { otp })
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to register customer" });
    }
  });
  
  // Verify OTP
  app.post("/api/registration/verify-otp", async (req, res) => {
    try {
      const { customerId, otp } = req.body;
      
      const customer = await RegistrationCustomer.findById(customerId);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      
      if (!customer.otp || !customer.otpExpiresAt) {
        return res.status(400).json({ error: "No OTP found for this customer" });
      }
      
      if (new Date() > customer.otpExpiresAt) {
        return res.status(400).json({ error: "OTP has expired" });
      }
      
      if (customer.otp !== otp) {
        return res.status(400).json({ error: "Invalid OTP" });
      }
      
      customer.isVerified = true;
      customer.otp = null;
      customer.otpExpiresAt = null;
      await customer.save();
      
      // Log customer creation activity (after verification)
      await logActivity({
        userId: customer._id.toString(),
        userName: customer.fullName,
        userRole: 'Customer',
        action: 'create',
        resource: 'customer',
        resourceId: customer._id.toString(),
        description: `New customer registered: ${customer.fullName}`,
        details: { referenceCode: customer.referenceCode, mobile: customer.mobileNumber },
        ipAddress: req.ip,
      });
      
      res.json({ 
        success: true,
        customer: {
          id: customer._id.toString(),
          referenceCode: customer.referenceCode,
          fullName: customer.fullName,
          mobileNumber: customer.mobileNumber,
          alternativeNumber: customer.alternativeNumber,
          email: customer.email,
          address: customer.address,
          city: customer.city,
          taluka: customer.taluka,
          district: customer.district,
          state: customer.state,
          pinCode: customer.pinCode,
          referralSource: customer.referralSource,
          isVerified: customer.isVerified,
          createdAt: customer.createdAt,
        },
        message: "Customer verified successfully"
      });
    } catch (error) {
      res.status(400).json({ error: "OTP verification failed" });
    }
  });
  
  // Add vehicle to customer
  app.post("/api/registration/vehicles", async (req, res) => {
    try {
      const validatedData = insertVehicleSchema.parse(req.body);
      
      // Check if customer exists
      const customer = await RegistrationCustomer.findById(validatedData.customerId);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      
      // Check if vehicle number already exists (only if vehicle number is provided)
      if (validatedData.vehicleNumber) {
        const existing = await RegistrationVehicle.findOne({ vehicleNumber: validatedData.vehicleNumber });
        if (existing) {
          return res.status(400).json({ error: "Vehicle number already registered" });
        }
      }
      
      // Generate unique vehicle ID (VEH001, VEH002, etc.)
      const vehicleSeq = await getNextSequence('vehicle');
      const vehicleId = `VEH${String(vehicleSeq).padStart(3, '0')}`;
      
      const vehicle = await RegistrationVehicle.create({
        ...validatedData,
        vehicleId
      });
      
      // TODO: Send confirmation notification (SMS/WhatsApp/Email)
      const vehicleInfo = vehicle.vehicleNumber ? `(${vehicle.vehicleNumber})` : `(${vehicle.chassisNumber || 'New Vehicle'})`;
      const message = `Dear ${customer.fullName}, your car ${vehicle.vehicleBrand} ${vehicle.vehicleModel} ${vehicleInfo} has been registered successfully. Your Reference ID: ${customer.referenceCode}`;
      console.log(message);
      
      res.json({ 
        vehicle: {
          id: vehicle._id.toString(),
          vehicleId: vehicle.vehicleId,
          customerId: vehicle.customerId,
          vehicleNumber: vehicle.vehicleNumber,
          vehicleBrand: vehicle.vehicleBrand,
          vehicleModel: vehicle.vehicleModel,
          customModel: vehicle.customModel,
          variant: vehicle.variant,
          color: vehicle.color,
          yearOfPurchase: vehicle.yearOfPurchase,
          vehiclePhoto: vehicle.vehiclePhoto,
          isNewVehicle: vehicle.isNewVehicle,
          chassisNumber: vehicle.chassisNumber,
          selectedParts: vehicle.selectedParts,
          createdAt: vehicle.createdAt,
        },
        customer: {
          id: customer._id.toString(),
          referenceCode: customer.referenceCode,
          fullName: customer.fullName,
        },
        message: "Vehicle registered successfully"
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to register vehicle" });
    }
  });
  
  // Get customer with vehicles
  app.get("/api/registration/customers/:id", async (req, res) => {
    try {
      const customer = await RegistrationCustomer.findById(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      
      const vehicles = await RegistrationVehicle.find({ customerId: req.params.id });
      
      res.json({ 
        customer: {
          id: customer._id.toString(),
          referenceCode: customer.referenceCode,
          fullName: customer.fullName,
          mobileNumber: customer.mobileNumber,
          alternativeNumber: customer.alternativeNumber,
          email: customer.email,
          address: customer.address,
          city: customer.city,
          taluka: customer.taluka,
          district: customer.district,
          state: customer.state,
          pinCode: customer.pinCode,
          referralSource: customer.referralSource,
          isVerified: customer.isVerified,
          createdAt: customer.createdAt,
        },
        vehicles: vehicles.map(v => ({
          id: v._id.toString(),
          vehicleId: v.vehicleId,
          customerId: v.customerId,
          vehicleNumber: v.vehicleNumber,
          vehicleBrand: v.vehicleBrand,
          vehicleModel: v.vehicleModel,
          customModel: v.customModel,
          variant: v.variant,
          color: v.color,
          yearOfPurchase: v.yearOfPurchase,
          vehiclePhoto: v.vehiclePhoto,
          isNewVehicle: v.isNewVehicle,
          chassisNumber: v.chassisNumber,
          selectedParts: v.selectedParts,
          createdAt: v.createdAt,
        }))
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customer" });
    }
  });
  
  // Get all registered customers with filtering
  app.get("/api/registration/customers", async (req, res) => {
    try {
      const { city, district, state, isVerified } = req.query;
      const filters: any = {};
      
      if (city) filters.city = city as string;
      if (district) filters.district = district as string;
      if (state) filters.state = state as string;
      if (isVerified !== undefined) filters.isVerified = isVerified === 'true';
      
      const customers = await RegistrationCustomer.find(filters).sort({ createdAt: -1 });
      
      res.json(customers.map(c => ({
        id: c._id.toString(),
        referenceCode: c.referenceCode,
        fullName: c.fullName,
        mobileNumber: c.mobileNumber,
        alternativeNumber: c.alternativeNumber,
        email: c.email,
        address: c.address,
        city: c.city,
        taluka: c.taluka,
        district: c.district,
        state: c.state,
        pinCode: c.pinCode,
        referralSource: c.referralSource,
        isVerified: c.isVerified,
        createdAt: c.createdAt,
      })));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });
  
  // Get vehicles by customer
  app.get("/api/registration/customers/:id/vehicles", async (req, res) => {
    try {
      const vehicles = await RegistrationVehicle.find({ customerId: req.params.id });
      res.json(vehicles.map(v => ({
        id: v._id.toString(),
        vehicleId: v.vehicleId,
        customerId: v.customerId,
        vehicleNumber: v.vehicleNumber,
        vehicleBrand: v.vehicleBrand,
        vehicleModel: v.vehicleModel,
        customModel: v.customModel,
        variant: v.variant,
        color: v.color,
        yearOfPurchase: v.yearOfPurchase,
        vehiclePhoto: v.vehiclePhoto,
        isNewVehicle: v.isNewVehicle,
        chassisNumber: v.chassisNumber,
        selectedParts: v.selectedParts,
        createdAt: v.createdAt,
      })));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicles" });
    }
  });
  
  // Update vehicle
  app.patch("/api/registration/vehicles/:id", async (req, res) => {
    try {
      const vehicle = await RegistrationVehicle.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!vehicle) {
        return res.status(404).json({ error: "Vehicle not found" });
      }
      res.json({
        id: vehicle._id.toString(),
        vehicleId: vehicle.vehicleId,
        customerId: vehicle.customerId,
        vehicleNumber: vehicle.vehicleNumber,
        vehicleBrand: vehicle.vehicleBrand,
        vehicleModel: vehicle.vehicleModel,
        customModel: vehicle.customModel,
        variant: vehicle.variant,
        color: vehicle.color,
        yearOfPurchase: vehicle.yearOfPurchase,
        vehiclePhoto: vehicle.vehiclePhoto,
        isNewVehicle: vehicle.isNewVehicle,
        chassisNumber: vehicle.chassisNumber,
        selectedParts: vehicle.selectedParts,
        createdAt: vehicle.createdAt,
      });
    } catch (error) {
      res.status(400).json({ error: "Failed to update vehicle" });
    }
  });
  
  // Delete vehicle
  app.delete("/api/registration/vehicles/:id", async (req, res) => {
    try {
      await RegistrationVehicle.findByIdAndDelete(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to delete vehicle" });
    }
  });
  
  // Resend OTP
  app.post("/api/registration/resend-otp", async (req, res) => {
    try {
      const { customerId } = req.body;
      
      const customer = await RegistrationCustomer.findById(customerId);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      
      if (customer.isVerified) {
        return res.status(400).json({ error: "Customer already verified" });
      }
      
      // Generate new OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      customer.otp = otp;
      customer.otpExpiresAt = otpExpiresAt;
      await customer.save();
      
      // TODO: Send OTP via SMS/WhatsApp
      console.log(`New OTP for ${customer.mobileNumber}: ${otp}`);
      
      res.json({ 
        message: "OTP resent successfully",
        ...(process.env.NODE_ENV === 'development' && { otp })
      });
    } catch (error) {
      res.status(400).json({ error: "Failed to resend OTP" });
    }
  });
  
  // Update customer (Admin only)
  app.patch("/api/registration/customers/:id", requireAuth, requirePermission("customers", "update"), async (req, res) => {
    try {
      const customer = await RegistrationCustomer.findById(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      
      // Update customer fields
      const updateData = req.body;
      Object.keys(updateData).forEach(key => {
        if (updateData[key] !== undefined && key !== '_id' && key !== 'referenceCode') {
          (customer as any)[key] = updateData[key];
        }
      });
      
      await customer.save();
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'update',
        resource: 'customer',
        resourceId: customer._id.toString(),
        description: `Updated customer: ${customer.fullName}`,
        details: { referenceCode: customer.referenceCode },
        ipAddress: req.ip,
      });
      
      res.json({
        id: customer._id.toString(),
        referenceCode: customer.referenceCode,
        fullName: customer.fullName,
        mobileNumber: customer.mobileNumber,
        alternativeNumber: customer.alternativeNumber,
        email: customer.email,
        address: customer.address,
        city: customer.city,
        taluka: customer.taluka,
        district: customer.district,
        state: customer.state,
        pinCode: customer.pinCode,
        isVerified: customer.isVerified,
        createdAt: customer.createdAt,
      });
    } catch (error) {
      res.status(400).json({ error: "Failed to update customer" });
    }
  });
  
  // Delete customer (Admin only)
  app.delete("/api/registration/customers/:id", requireAuth, requirePermission("customers", "delete"), async (req, res) => {
    try {
      const customer = await RegistrationCustomer.findById(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      
      // Delete all vehicles associated with this customer
      await RegistrationVehicle.deleteMany({ customerId: req.params.id });
      
      // Delete the customer
      await RegistrationCustomer.findByIdAndDelete(req.params.id);
      
      await logActivity({
        userId: (req as any).session.userId,
        userName: (req as any).session.userName,
        userRole: (req as any).session.userRole,
        action: 'delete',
        resource: 'customer',
        resourceId: customer._id.toString(),
        description: `Deleted customer: ${customer.fullName}`,
        details: { referenceCode: customer.referenceCode },
        ipAddress: req.ip,
      });
      
      res.json({ success: true, message: "Customer and associated vehicles deleted successfully" });
    } catch (error) {
      res.status(400).json({ error: "Failed to delete customer" });
    }
  });

  app.get("/api/activity-logs", requireAuth, requireRole('Admin'), async (req, res) => {
    try {
      const { limit = 50, role, resource, startDate, endDate } = req.query;
      
      const query: any = {};
      
      if (role) {
        query.userRole = role;
      }
      
      if (resource) {
        query.resource = resource;
      }
      
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) {
          query.createdAt.$gte = new Date(startDate as string);
        }
        if (endDate) {
          query.createdAt.$lte = new Date(endDate as string);
        }
      }
      
      const activities = await ActivityLog.find(query)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit as string))
        .lean();
      
      res.json(activities);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch activity logs" });
    }
  });

  app.post("/api/activity-logs", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).session.userId;
      const userName = (req as any).session.userName;
      const userRole = (req as any).session.userRole;
      
      const { action, resource, resourceId, description, details } = req.body;
      
      const activity = await ActivityLog.create({
        userId,
        userName,
        userRole,
        action,
        resource,
        resourceId,
        description,
        details,
        ipAddress: req.ip,
      });
      
      res.json(activity);
    } catch (error) {
      res.status(500).json({ error: "Failed to create activity log" });
    }
  });

  // Migration endpoint to add vehicleId to existing vehicles
  app.post("/api/migrate/vehicle-ids", requireAuth, requireRole('Admin'), async (req, res) => {
    try {
      const vehiclesWithoutId = await RegistrationVehicle.find({ 
        $or: [
          { vehicleId: { $exists: false } },
          { vehicleId: null },
          { vehicleId: '' }
        ]
      });
      
      let updated = 0;
      for (const vehicle of vehiclesWithoutId) {
        const vehicleSeq = await getNextSequence('vehicle');
        const vehicleId = `VEH${String(vehicleSeq).padStart(3, '0')}`;
        
        await RegistrationVehicle.updateOne(
          { _id: vehicle._id },
          { $set: { vehicleId } }
        );
        updated++;
      }
      
      res.json({ 
        success: true, 
        message: `Updated ${updated} vehicles with Vehicle IDs`,
        updated 
      });
    } catch (error) {
      res.status(500).json({ error: "Migration failed" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
