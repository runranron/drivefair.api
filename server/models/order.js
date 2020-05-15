const mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema.Types;

const orderItemSchema = new mongoose.Schema({
  menuItem: { type: ObjectId, ref: "MenuItem" },
  price: Number,
  modifications: Object,
});

const orderSchema = new mongoose.Schema({
  address: { type: ObjectId, ref: "Address" },
  customer: { type: ObjectId, ref: "Customer" },
  address: { type: ObjectId, ref: "Address" },
  vendor: { type: ObjectId, ref: "Vendor" },
  driver: { type: ObjectId, ref: "Driver" },
  orderItems: [{ type: ObjectId, ref: "OrderItem" }],
  method: { type: String, enums: ["DELIVERY", "PICKUP"], default: "PICKUP" },
  subtotal: { type: Number, default: 0 },
  tip: { type: Number, min: 0 },
  total: { type: Number, default: 0 },
  estimatedReadyTime: { type: Date },
  actualReadyTime: { type: Date },
  estimatedDeliveryTime: { type: Date },
  actualDeliveryTime: { type: Date },
  amountPaid: Number,
  createdOn: { type: Date, default: Date.now },
  disposition: {
    type: String,
    enums: [
      "NEW",
      "PAID",
      "ACCEPTED_BY_VENDOR",
      "ACCEPTED_BY_DRIVER",
      "READY",
      "ASSIGNED",
      "EN_ROUTE",
      "DELIVERED",
      "CANCELED",
    ],
    default: "NEW",
  },
  chargeId: String,
});

orderSchema.methods.addOrderItem = async function (item) {
  item.price = item.menuItem.price;
  item.modifications.forEach((modification) => {
    const { options } = modification;
    if (Array.isArray(options)) {
      modification.options.forEach((option) => {
        item.price += Number(option.price);
      });
    } else {
      item.price += Number(options.price);
    }
  });
  const newOrderItem = await new OrderItem({ ...item }).save();
  this.orderItems.push(newOrderItem);
  this.subtotal += item.price;
  return await this.save();
};

orderSchema.methods.removeOrderItem = async function (itemId) {
  const orderItem = await OrderItem.findById(itemId);
  await this.orderItems.pull(itemId);
  this.subtotal -= orderItem.price;
  await orderItem.remove();
  return await this.save();
};

orderSchema.methods.vendorAcceptOrder = async function ({
  vendor,
  selectedDriver,
  timeToReady,
}) {
  try {
    if (this.vendor.toString() !== vendor._id.toString()) {
      return { error: "Unauthorized", functionName: "vendorAcceptOrder" };
    }
    if (this.method === "DELIVERY") {
      const driverRequest = await this.selectDriver(selectedDriver);
      if (driverRequest.error) {
        return { error: driverRequest.error, functionName: "requestDriver" };
      }
    }
    this.estimatedReadyTime = new Date(Date.now() + timeToReady * 60 * 1000);
    this.disposition = "ACCEPTED_BY_VENDOR";
    return await this.save();
  } catch (error) {
    return { error, functionName: "vendorAcceptOrder" };
  }
};

orderSchema.methods.selectDriver = async function (driver) {
  console.log(driver);
  try {
    if (driver.status !== "ACTIVE") {
      return {
        error: "Selected driver is currently inactive.",
      };
    }
    return await driver.addOrderToRoute(this._id);
  } catch (error) {
    return { error };
  }
};

const OrderItem = mongoose.model("OrderItem", orderItemSchema);
const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
