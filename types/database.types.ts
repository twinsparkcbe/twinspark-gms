/**
 * Hand-written Supabase DB types, matching supabase/migrations/0001_inventory_schema.sql.
 *
 * Once the Supabase CLI/network access is available, regenerate for real and
 * this file becomes redundant:
 *
 *   npx supabase gen types typescript --project-id oxdokxoblbijghiekzcr > types/database.types.ts
 *
 * Keep this file's shape in sync with each new migration in the meantime —
 * add a Tables/Enums/Functions entry per migration, don't just leave it stale.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ItemType =
  | "TRACK_TYRE"
  | "BRAND_NEW_TYRE"
  | "ENGINE_OIL"
  | "CHAIN"
  | "SPROCKET_KIT"
  | "BRAKE_PART"
  | "LUBRICANT"
  | "ACCESSORY"
  | "OTHER_SPARE_PART";

export type StockMovementReason =
  | "PURCHASE"
  | "PURCHASE_RETURN"
  | "SALE"
  | "SALE_RETURN"
  | "SERVICE_USAGE"
  | "ONLINE_ORDER_DISPATCH"
  | "MANUAL_CORRECTION"
  | "DAMAGE";

export type OnlineOrderStatus =
  | "SUBMITTED"
  | "PAYMENT_VERIFIED"
  | "APPROVED"
  | "DISPATCHED"
  | "REJECTED";

export type SaleLineType = "PRODUCT" | "INSTALLATION" | "COMBO";
/** Sale payment status (0024). Narrower than Service's — no FREE_SERVICE,
 * which has no counter-sale equivalent. */
export type SalePaymentStatus = "PENDING" | "PARTIAL" | "PAID";
/** How a bill was tendered (0027). Null on rows written before the column
 * existed — "unrecorded", never assumed to be cash. */
export type PaymentMode = "CASH" | "UPI" | "SPLIT";
export type InstallationSubtype = "TYRE_FITTING" | "CUSTOM";

export type ServiceJobStatus = "DRAFT" | "IN_PROGRESS" | "READY_FOR_DELIVERY" | "COMPLETED" | "CANCELLED";
export type ServiceLineType = "PACKAGE" | "SPECIFIC" | "CUSTOM" | "COMBO";

/** Combo Offers (0021) — shared by Service and Sales. */
export type ComboComponentType = "PACKAGE" | "SPECIFIC" | "ITEM";
export type ComboComponentPricing = "INCLUDED" | "EXTRA";
export type ServicePaymentStatus = "PENDING" | "PARTIAL" | "PAID" | "FREE_SERVICE";
export type ServiceDeliveryStatus = "WAITING" | "READY_FOR_PICKUP" | "DELIVERED";
export type ServiceJobEventType =
  | "JOB_CREATED"
  | "STATUS_CHANGED"
  | "JOB_COMPLETED"
  | "PAYMENT_STATUS_CHANGED"
  | "DELIVERY_STATUS_CHANGED"
  /** A completed job was corrected in place, invoice number kept (0028). */
  | "JOB_EDITED"
  /** A completion was reversed: stock restored, invoice number voided (0028). */
  | "JOB_UNCOMPLETED";
export type ServiceImageType = "BEFORE" | "AFTER";
export type UserRoleEnum = "admin" | "sales_person" | "mechanic";

/**
 * Attendance Management (0031) — a standalone module with its own employee
 * roster. `AttendanceRole` is deliberately separate from `UserRoleEnum`
 * above: that one is about who can log in, this one is about what a person
 * does on the shop floor. They must be free to diverge.
 */
export type AttendanceRole = "SALES_PERSON" | "SERVICE_PERSON" | "OTHER_STAFF";
export type AttendanceStatus = "FULL_DAY" | "FIRST_HALF" | "SECOND_HALF" | "ABSENT";

export interface Database {
  public: {
    Tables: {
      attendance_employees: {
        Row: {
          id: string;
          employee_code: string;
          name: string;
          role: AttendanceRole;
          /** Set only when role is OTHER_STAFF; null otherwise (DB CHECK). */
          other_role_description: string | null;
          mobile: string | null;
          joining_date: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          /** Optional — the DB issues "001", "002", ... from a sequence. */
          employee_code?: string;
          name: string;
          role: AttendanceRole;
          other_role_description?: string | null;
          mobile?: string | null;
          joining_date: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          employee_code?: string;
          name?: string;
          role?: AttendanceRole;
          other_role_description?: string | null;
          mobile?: string | null;
          joining_date?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      attendance_records: {
        Row: {
          id: string;
          employee_id: string;
          attendance_date: string;
          status: AttendanceStatus;
          /** "HH:MM:SS" — a plain wall-clock time, not an instant. */
          check_in: string | null;
          check_out: string | null;
          /** Generated column — read-only, never present on Insert/Update. */
          working_minutes: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          attendance_date: string;
          status: AttendanceStatus;
          check_in?: string | null;
          check_out?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          attendance_date?: string;
          status?: AttendanceStatus;
          check_in?: string | null;
          check_out?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey";
            columns: ["employee_id"];
            referencedRelation: "attendance_employees";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_qr_configs: {
        Row: {
          id: string;
          label: string;
          upi_id: string;
          payee_name: string;
          qr_image_path: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          label: string;
          upi_id: string;
          payee_name: string;
          qr_image_path: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          label?: string;
          upi_id?: string;
          payee_name?: string;
          qr_image_path?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: UserRoleEnum;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          role?: UserRoleEnum;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          role?: UserRoleEnum;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      brands: {
        Row: {
          id: string;
          name: string;
          item_type: ItemType;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          item_type: ItemType;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          item_type?: ItemType;
          created_at?: string;
        };
        Relationships: [];
      };
      inventory_items: {
        Row: {
          id: string;
          item_type: ItemType;
          product_name: string;
          sku_code: string;
          brand_id: string | null;
          purchase_price: number;
          selling_price: number;
          available_quantity: number;
          low_stock_threshold: number;
          /** Generated column — read-only, never set directly. */
          stock_status: "in_stock" | "low_stock" | "out_of_stock";
          is_active: boolean;
          image_url: string | null;
          custom_type_label: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          item_type: ItemType;
          product_name: string;
          sku_code: string;
          brand_id?: string | null;
          purchase_price: number;
          selling_price: number;
          available_quantity?: number;
          low_stock_threshold?: number;
          is_active?: boolean;
          image_url?: string | null;
          custom_type_label?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          item_type?: ItemType;
          product_name?: string;
          sku_code?: string;
          brand_id?: string | null;
          purchase_price?: number;
          selling_price?: number;
          available_quantity?: number;
          low_stock_threshold?: number;
          is_active?: boolean;
          image_url?: string | null;
          custom_type_label?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_items_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: {
          id: string;
          inventory_item_id: string;
          delta: number;
          resulting_balance: number;
          reason: StockMovementReason;
          source_module: string;
          note: string | null;
          created_by: string | null;
          created_at: string;
          /** Which batch this movement increased/came from — null for movements that predate 0010. */
          purchase_entry_id: string | null;
        };
        Insert: {
          id?: string;
          inventory_item_id: string;
          delta: number;
          resulting_balance: number;
          reason: StockMovementReason;
          source_module: string;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          purchase_entry_id?: string | null;
        };
        Update: {
          id?: string;
          inventory_item_id?: string;
          delta?: number;
          resulting_balance?: number;
          reason?: StockMovementReason;
          source_module?: string;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          purchase_entry_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_purchase_entry_id_fkey";
            columns: ["purchase_entry_id"];
            isOneToOne: false;
            referencedRelation: "purchase_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_entries: {
        Row: {
          id: string;
          inventory_item_id: string;
          quantity: number;
          unit_price: number;
          /** Generated column — quantity * unit_price, read-only. */
          total_amount: number;
          /** Auto-generated (next_batch_number()), e.g. "BATCH-000001". */
          batch_number: string;
          /** How much of this batch hasn't been sold/returned yet — starts equal to quantity. */
          remaining_quantity: number;
          /** Required per-batch selling price (0011_purchases_item_ownership.sql). */
          selling_price: number;
          supplier_name: string | null;
          purchase_date: string;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          inventory_item_id: string;
          quantity: number;
          unit_price: number;
          batch_number?: string;
          remaining_quantity?: number;
          selling_price: number;
          supplier_name?: string | null;
          purchase_date: string;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          inventory_item_id?: string;
          quantity?: number;
          unit_price?: number;
          batch_number?: string;
          remaining_quantity?: number;
          selling_price?: number;
          supplier_name?: string | null;
          purchase_date?: string;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_entries_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_returns: {
        Row: {
          id: string;
          purchase_entry_id: string;
          inventory_item_id: string;
          quantity: number;
          reason: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          purchase_entry_id: string;
          inventory_item_id: string;
          quantity: number;
          reason: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          purchase_entry_id?: string;
          inventory_item_id?: string;
          quantity?: number;
          reason?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_returns_purchase_entry_id_fkey";
            columns: ["purchase_entry_id"];
            isOneToOne: false;
            referencedRelation: "purchase_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_returns_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          id: string;
          name: string;
          mobile_number: string;
          address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          mobile_number: string;
          address?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          mobile_number?: string;
          address?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      sales: {
        Row: {
          id: string;
          customer_id: string;
          sale_date: string;
          gst_applicable: boolean;
          gst_amount: number;
          discount_applicable: boolean;
          discount_amount: number;
          subtotal: number;
          installation_total: number;
          grand_total: number;
          invoice_number: string;
          payment_status: SalePaymentStatus;
          payment_mode: PaymentMode | null;
          cash_amount: number;
          upi_amount: number;
          needs_service_followup: boolean;
          sold_by_id?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          void_reason?: string | null;
          service_followup_note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          sale_date?: string;
          gst_applicable?: boolean;
          gst_amount?: number;
          discount_applicable?: boolean;
          discount_amount?: number;
          subtotal?: number;
          installation_total?: number;
          grand_total?: number;
          invoice_number: string;
          payment_status?: SalePaymentStatus;
          payment_mode?: PaymentMode | null;
          cash_amount?: number;
          upi_amount?: number;
          needs_service_followup?: boolean;
          sold_by_id?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          void_reason?: string | null;
          service_followup_note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          customer_id?: string;
          sale_date?: string;
          gst_applicable?: boolean;
          gst_amount?: number;
          discount_applicable?: boolean;
          discount_amount?: number;
          subtotal?: number;
          installation_total?: number;
          grand_total?: number;
          invoice_number?: string;
          payment_status?: SalePaymentStatus;
          payment_mode?: PaymentMode | null;
          cash_amount?: number;
          upi_amount?: number;
          needs_service_followup?: boolean;
          sold_by_id?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          void_reason?: string | null;
          service_followup_note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_items: {
        Row: {
          id: string;
          sale_id: string;
          position: number;
          line_type: SaleLineType;
          inventory_item_id: string | null;
          quantity: number | null;
          unit_selling_price: number | null;
          installation_subtype: InstallationSubtype | null;
          wheel_count: number | null;
          description: string | null;
          amount: number | null;
          installed_by: string | null;
          /** Combo Offers (0022) — set on a COMBO line, and on the product
           * rows that combo brought in. */
          combo_id: string | null;
          combo_contents: string[] | null;
          combo_list_value: number | null;
          included_in_combo: boolean;
          /** Generated column — read-only, never set directly. */
          line_total: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          sale_id: string;
          position: number;
          line_type: SaleLineType;
          inventory_item_id?: string | null;
          quantity?: number | null;
          unit_selling_price?: number | null;
          installation_subtype?: InstallationSubtype | null;
          wheel_count?: number | null;
          description?: string | null;
          amount?: number | null;
          installed_by?: string | null;
          combo_id?: string | null;
          combo_contents?: string[] | null;
          combo_list_value?: number | null;
          included_in_combo?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          sale_id?: string;
          position?: number;
          line_type?: SaleLineType;
          inventory_item_id?: string | null;
          quantity?: number | null;
          unit_selling_price?: number | null;
          installation_subtype?: InstallationSubtype | null;
          wheel_count?: number | null;
          description?: string | null;
          amount?: number | null;
          installed_by?: string | null;
          combo_id?: string | null;
          combo_contents?: string[] | null;
          combo_list_value?: number | null;
          included_in_combo?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sale_items_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_returns: {
        Row: {
          id: string;
          sale_item_id: string;
          inventory_item_id: string;
          quantity: number;
          reason: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          sale_item_id: string;
          inventory_item_id: string;
          quantity: number;
          reason: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          sale_item_id?: string;
          inventory_item_id?: string;
          quantity?: number;
          reason?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sale_returns_sale_item_id_fkey";
            columns: ["sale_item_id"];
            isOneToOne: false;
            referencedRelation: "sale_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_returns_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicles: {
        Row: {
          id: string;
          customer_id: string;
          vehicle_number: string;
          vehicle_model: string;
          latest_odometer_reading: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          vehicle_number: string;
          vehicle_model: string;
          latest_odometer_reading?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          customer_id?: string;
          vehicle_number?: string;
          vehicle_model?: string;
          latest_odometer_reading?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vehicles_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      general_service_packages: {
        Row: {
          id: string;
          name: string;
          included_items: string[];
          service_charge: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          included_items?: string[];
          service_charge: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          included_items?: string[];
          service_charge?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      combos: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          combo_price: number;
          valid_from: string | null;
          valid_to: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          combo_price: number;
          valid_from?: string | null;
          valid_to?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          combo_price?: number;
          valid_from?: string | null;
          valid_to?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      combo_components: {
        Row: {
          id: string;
          combo_id: string;
          position: number;
          component_type: ComboComponentType;
          general_service_package_id: string | null;
          specific_service_id: string | null;
          inventory_item_id: string | null;
          quantity: number;
          pricing: ComboComponentPricing;
          created_at: string;
        };
        Insert: {
          id?: string;
          combo_id: string;
          position: number;
          component_type: ComboComponentType;
          general_service_package_id?: string | null;
          specific_service_id?: string | null;
          inventory_item_id?: string | null;
          quantity?: number;
          pricing?: ComboComponentPricing;
          created_at?: string;
        };
        Update: {
          id?: string;
          combo_id?: string;
          position?: number;
          component_type?: ComboComponentType;
          general_service_package_id?: string | null;
          specific_service_id?: string | null;
          inventory_item_id?: string | null;
          quantity?: number;
          pricing?: ComboComponentPricing;
          created_at?: string;
        };
        Relationships: [];
      };
      specific_services: {
        Row: {
          id: string;
          name: string;
          default_charge: number | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          default_charge?: number | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          default_charge?: number | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      service_jobs: {
        Row: {
          id: string;
          job_number: string;
          invoice_number: string | null;
          customer_id: string;
          vehicle_id: string;
          odometer_reading: number;
          status: ServiceJobStatus;
          complaint_notes: string | null;
          mechanic_notes: string | null;
          expected_delivery_at: string | null;
          completed_at: string | null;
          delivered_at: string | null;
          payment_status: ServicePaymentStatus | null;
          payment_mode: PaymentMode | null;
          cash_amount: number;
          upi_amount: number;
          delivery_status: ServiceDeliveryStatus | null;
          gst_applicable: boolean;
          gst_amount: number;
          discount_applicable: boolean;
          discount_amount: number;
          subtotal: number;
          inventory_total: number;
          grand_total: number;
          created_by: string | null;
          assigned_mechanic_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          job_number: string;
          invoice_number?: string | null;
          customer_id: string;
          vehicle_id: string;
          odometer_reading: number;
          status?: ServiceJobStatus;
          complaint_notes?: string | null;
          mechanic_notes?: string | null;
          expected_delivery_at?: string | null;
          completed_at?: string | null;
          delivered_at?: string | null;
          payment_status?: ServicePaymentStatus | null;
          payment_mode?: PaymentMode | null;
          cash_amount?: number;
          upi_amount?: number;
          delivery_status?: ServiceDeliveryStatus | null;
          gst_applicable?: boolean;
          gst_amount?: number;
          discount_applicable?: boolean;
          discount_amount?: number;
          subtotal?: number;
          inventory_total?: number;
          grand_total?: number;
          created_by?: string | null;
          assigned_mechanic_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          job_number?: string;
          invoice_number?: string | null;
          customer_id?: string;
          vehicle_id?: string;
          odometer_reading?: number;
          status?: ServiceJobStatus;
          complaint_notes?: string | null;
          mechanic_notes?: string | null;
          expected_delivery_at?: string | null;
          completed_at?: string | null;
          delivered_at?: string | null;
          payment_status?: ServicePaymentStatus | null;
          payment_mode?: PaymentMode | null;
          cash_amount?: number;
          upi_amount?: number;
          delivery_status?: ServiceDeliveryStatus | null;
          gst_applicable?: boolean;
          gst_amount?: number;
          discount_applicable?: boolean;
          discount_amount?: number;
          subtotal?: number;
          inventory_total?: number;
          grand_total?: number;
          created_by?: string | null;
          assigned_mechanic_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_jobs_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_jobs_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_jobs_assigned_mechanic_id_fkey";
            columns: ["assigned_mechanic_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      service_job_lines: {
        Row: {
          id: string;
          service_job_id: string;
          position: number;
          line_type: ServiceLineType;
          general_service_package_id: string | null;
          specific_service_id: string | null;
          /** Combo Offers (0022) — set only on a COMBO line. */
          combo_id: string | null;
          /** Snapshotted breakdown printed under a COMBO line. */
          combo_contents: string[] | null;
          /** What the bundle was worth separately, snapshotted at sale time. */
          combo_list_value: number | null;
          description: string;
          quantity: number;
          rate: number;
          /** Generated column — quantity * rate, read-only. */
          amount: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          service_job_id: string;
          position: number;
          line_type: ServiceLineType;
          general_service_package_id?: string | null;
          specific_service_id?: string | null;
          combo_id?: string | null;
          combo_contents?: string[] | null;
          combo_list_value?: number | null;
          description: string;
          quantity?: number;
          rate: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          service_job_id?: string;
          position?: number;
          line_type?: ServiceLineType;
          general_service_package_id?: string | null;
          specific_service_id?: string | null;
          combo_id?: string | null;
          combo_contents?: string[] | null;
          combo_list_value?: number | null;
          description?: string;
          quantity?: number;
          rate?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_job_lines_service_job_id_fkey";
            columns: ["service_job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      service_inventory_usage: {
        Row: {
          id: string;
          service_job_id: string;
          inventory_item_id: string;
          item_name_snapshot: string;
          quantity_used: number;
          unit_price_snapshot: number;
          /** Generated column — quantity_used * unit_price_snapshot, read-only. */
          line_total: number;
          stock_deducted: boolean;
          /** Combo Offers (0022) — which combo brought this part in. */
          combo_id: string | null;
          /** Billed at ₹0 because the combo price covers it; stock still moves. */
          included_in_combo: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          service_job_id: string;
          inventory_item_id: string;
          item_name_snapshot: string;
          quantity_used: number;
          unit_price_snapshot: number;
          stock_deducted?: boolean;
          combo_id?: string | null;
          included_in_combo?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          service_job_id?: string;
          inventory_item_id?: string;
          item_name_snapshot?: string;
          quantity_used?: number;
          unit_price_snapshot?: number;
          stock_deducted?: boolean;
          combo_id?: string | null;
          included_in_combo?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_inventory_usage_service_job_id_fkey";
            columns: ["service_job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_inventory_usage_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
        ];
      };
      service_job_events: {
        Row: {
          id: string;
          service_job_id: string;
          event_type: ServiceJobEventType;
          detail: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          service_job_id: string;
          event_type: ServiceJobEventType;
          detail?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          service_job_id?: string;
          event_type?: ServiceJobEventType;
          detail?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_job_events_service_job_id_fkey";
            columns: ["service_job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      general_service_package_items: {
        Row: {
          id: string;
          general_service_package_id: string;
          inventory_item_id: string;
          default_quantity: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          general_service_package_id: string;
          inventory_item_id: string;
          default_quantity?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          general_service_package_id?: string;
          inventory_item_id?: string;
          default_quantity?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "general_service_package_items_general_service_package_id_fkey";
            columns: ["general_service_package_id"];
            isOneToOne: false;
            referencedRelation: "general_service_packages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "general_service_package_items_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
        ];
      };
      specific_service_items: {
        Row: {
          id: string;
          specific_service_id: string;
          inventory_item_id: string;
          default_quantity: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          specific_service_id: string;
          inventory_item_id: string;
          default_quantity?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          specific_service_id?: string;
          inventory_item_id?: string;
          default_quantity?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "specific_service_items_specific_service_id_fkey";
            columns: ["specific_service_id"];
            isOneToOne: false;
            referencedRelation: "specific_services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "specific_service_items_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
        ];
      };
      service_job_images: {
        Row: {
          id: string;
          service_job_id: string;
          image_type: ServiceImageType;
          storage_path: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          service_job_id: string;
          image_type: ServiceImageType;
          storage_path: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          service_job_id?: string;
          image_type?: ServiceImageType;
          storage_path?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_job_images_service_job_id_fkey";
            columns: ["service_job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      online_orders: {
        Row: {
          id: string;
          customer_name: string;
          mobile_number: string;
          address: string;
          pin_code: string;
          quantity_front: number;
          quantity_back: number;
          payment_screenshot_path: string;
          unit_price_front: number | null;
          unit_price_back: number | null;
          total_amount: number;
          status: OnlineOrderStatus;
          rejection_reason: string | null;
          submitted_at: string;
          verified_by: string | null;
          verified_at: string | null;
          approved_by: string | null;
          approved_at: string | null;
          dispatched_by: string | null;
          dispatched_at: string | null;
          rejected_by: string | null;
          rejected_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_name: string;
          mobile_number: string;
          address: string;
          pin_code: string;
          quantity_front?: number;
          quantity_back?: number;
          payment_screenshot_path: string;
          unit_price_front?: number | null;
          unit_price_back?: number | null;
          total_amount?: number;
          status?: OnlineOrderStatus;
          rejection_reason?: string | null;
          submitted_at?: string;
          verified_by?: string | null;
          verified_at?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          dispatched_by?: string | null;
          dispatched_at?: string | null;
          rejected_by?: string | null;
          rejected_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          customer_name?: string;
          mobile_number?: string;
          address?: string;
          pin_code?: string;
          quantity_front?: number;
          quantity_back?: number;
          payment_screenshot_path?: string;
          unit_price_front?: number | null;
          unit_price_back?: number | null;
          total_amount?: number;
          status?: OnlineOrderStatus;
          rejection_reason?: string | null;
          submitted_at?: string;
          verified_by?: string | null;
          verified_at?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          dispatched_by?: string | null;
          dispatched_at?: string | null;
          rejected_by?: string | null;
          rejected_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      adjust_stock: {
        Args: {
          p_item_id: string;
          p_delta: number;
          p_reason: StockMovementReason;
          p_source_module: string;
          p_note?: string | null;
          /** Explicit batch target — PURCHASE increases and PURCHASE_RETURN decreases only. Omit for FIFO/synthetic-batch behavior. */
          p_purchase_entry_id?: string | null;
          /** Cost for a synthetic batch on a delta > 0 with no p_purchase_entry_id (Opening Stock / positive Manual Correction). Falls back to the item's most recent batch cost if omitted. */
          p_unit_cost?: number | null;
        };
        Returns: number;
      };
      next_inventory_sku: {
        Args: Record<string, never>;
        Returns: string;
      };
      next_batch_number: {
        Args: Record<string, never>;
        Returns: string;
      };
      record_purchase_entry: {
        Args: {
          p_inventory_item_id: string;
          p_quantity: number;
          p_unit_price: number;
          p_purchase_date: string;
          p_supplier_name?: string | null;
          p_note?: string | null;
          p_selling_price?: number | null;
        };
        Returns: string;
      };
      create_inventory_item_with_purchase: {
        Args: {
          p_item_type: ItemType;
          p_product_name: string;
          p_sku_code?: string | null;
          p_brand_id: string;
          p_low_stock_threshold: number;
          p_custom_type_label?: string | null;
          p_image_url?: string | null;
          p_quantity: number;
          p_unit_price: number;
          p_selling_price: number;
          p_purchase_date: string;
          p_supplier_name?: string | null;
          p_note?: string | null;
        };
        Returns: string;
      };
      update_purchase_entry: {
        Args: {
          p_entry_id: string;
          p_quantity: number;
          p_unit_price: number;
          p_selling_price: number;
          p_purchase_date: string;
          p_supplier_name?: string | null;
          p_note?: string | null;
        };
        Returns: string;
      };
      record_purchase_return: {
        Args: {
          p_purchase_entry_id: string;
          p_quantity: number;
          p_reason: string;
        };
        Returns: string;
      };
      next_sales_invoice_number: {
        Args: Record<string, never>;
        Returns: string;
      };
      record_sale: {
        Args: {
          p_customer_name: string;
          p_customer_mobile: string;
          p_customer_address?: string | null;
          p_gst_applicable: boolean;
          p_gst_amount: number;
          p_discount_applicable: boolean;
          p_discount_amount: number;
          /** Array of PRODUCT/INSTALLATION/COMBO line objects — see
           * 0013_sales_schema.sql and 0022_combo_lines.sql for the shapes. */
          p_lines: Json;
          /** 0024. Superseded by record_sale_with_payment() below — the app
           * no longer passes a status, the server derives one. */
          p_payment_status?: string;
          /** Who made the sale (0029). */
          p_sold_by_id?: string | null;
        };
        Returns: string;
      };
      /** 0027 — the only path the app uses to record a sale. Wraps
       * record_sale() and applies the tender in the same transaction;
       * payment_status is derived server-side from the amounts. */
      record_sale_with_payment: {
        Args: {
          p_customer_name: string;
          p_customer_mobile: string;
          p_customer_address?: string | null;
          p_gst_applicable: boolean;
          p_gst_amount: number;
          p_discount_applicable: boolean;
          p_discount_amount: number;
          p_lines: Json;
          p_payment_mode: PaymentMode | null;
          p_cash_amount: number;
          p_upi_amount: number;
          /** Who made the sale (0029). Null is a valid "Unassigned". */
          p_sold_by_id?: string | null;
        };
        Returns: string;
      };
      derive_payment_status: {
        Args: { p_cash_amount: number; p_upi_amount: number; p_grand_total: number };
        Returns: string;
      };
      derive_payment_mode: {
        Args: { p_cash_amount: number; p_upi_amount: number };
        Returns: string | null;
      };
      record_sale_return: {
        Args: {
          p_sale_item_id: string;
          p_quantity: number;
          p_reason: string;
        };
        Returns: string;
      };
      undo_sale_return: {
        Args: {
          p_sale_return_id: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      escalate_sale_to_service: {
        Args: {
          p_sale_id: string;
          p_note?: string | null;
        };
        Returns: undefined;
      };
      next_service_job_number: {
        Args: Record<string, never>;
        Returns: string;
      };
      next_service_invoice_number: {
        Args: Record<string, never>;
        Returns: string;
      };
      create_service_job: {
        Args: {
          p_customer_name: string;
          p_customer_mobile: string;
          p_customer_address?: string | null;
          p_vehicle_number: string;
          p_vehicle_model: string;
          p_odometer_reading: number;
          p_complaint_notes?: string | null;
          p_mechanic_notes?: string | null;
          p_expected_delivery_at?: string | null;
          p_gst_applicable: boolean;
          p_gst_amount: number;
          p_discount_applicable: boolean;
          p_discount_amount: number;
          /** Array of PACKAGE/SPECIFIC/CUSTOM line objects — see 0016_service_schema.sql's header comment for shape. */
          p_lines: Json;
          /** Array of {inventory_item_id, quantity_used} objects — no stock deducted at this point. */
          p_usage: Json;
        };
        Returns: string;
      };
      update_service_job: {
        Args: {
          p_service_job_id: string;
          p_customer_name: string;
          p_customer_mobile: string;
          p_customer_address?: string | null;
          p_vehicle_number: string;
          p_vehicle_model: string;
          p_odometer_reading: number;
          p_complaint_notes?: string | null;
          p_mechanic_notes?: string | null;
          p_expected_delivery_at?: string | null;
          p_gst_applicable: boolean;
          p_gst_amount: number;
          p_discount_applicable: boolean;
          p_discount_amount: number;
          p_lines: Json;
          p_usage: Json;
        };
        Returns: undefined;
      };
      update_service_job_status: {
        Args: {
          p_service_job_id: string;
          p_new_status: string;
          p_note?: string | null;
        };
        Returns: undefined;
      };
      /** Corrects a recorded sale in place (0029) — invoice number kept, stock
       * reconciled, payment re-derived. Administrator or Sales Person. */
      edit_sale: {
        Args: {
          p_sale_id: string;
          p_customer_name: string;
          p_customer_mobile: string;
          p_customer_address?: string | null;
          p_gst_applicable: boolean;
          p_gst_amount: number;
          p_discount_applicable: boolean;
          p_discount_amount: number;
          p_lines: Json;
          p_sold_by_id?: string | null;
          p_payment_mode?: PaymentMode | null;
          p_cash_amount?: number;
          p_upi_amount?: number;
        };
        Returns: undefined;
      };
      /** Marks a sale as never having happened (0029): stock restored, tender
       * cleared, row kept with its invoice number and a Voided stamp. */
      void_sale: {
        Args: {
          p_sale_id: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      complete_service_job: {
        Args: {
          p_service_job_id: string;
        };
        Returns: string;
      };
      /** Reverses a completion (0028): restores stock, voids the invoice
       * number, drops the job back to In Progress. Administrator-only. */
      undo_service_completion: {
        Args: {
          p_service_job_id: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      /** Corrects an already-billed job in place (0028), keeping its invoice
       * number and reconciling stock to the corrected parts list.
       * Administrator-only. */
      edit_completed_service_job: {
        Args: {
          p_service_job_id: string;
          p_customer_name: string;
          p_customer_mobile: string;
          p_customer_address?: string | null;
          p_vehicle_number: string;
          p_vehicle_model: string;
          p_odometer_reading: number;
          p_complaint_notes?: string | null;
          p_mechanic_notes?: string | null;
          p_expected_delivery_at?: string | null;
          p_gst_applicable: boolean;
          p_gst_amount: number;
          p_discount_applicable: boolean;
          p_discount_amount: number;
          p_lines: Json;
          p_usage: Json;
          p_assigned_mechanic_id?: string | null;
          p_payment_mode?: PaymentMode | null;
          p_cash_amount?: number;
          p_upi_amount?: number;
          /** FREE_SERVICE is an explicit override, never derived from the
           * amounts (0027). */
          p_free_service?: boolean;
        };
        Returns: undefined;
      };
      update_service_payment_status: {
        Args: {
          p_service_job_id: string;
          p_payment_mode: PaymentMode | null;
          p_cash_amount: number;
          p_upi_amount: number;
          /** FREE_SERVICE is an explicit override, never derived from the
           * amounts (0027). */
          p_free_service?: boolean;
        };
        Returns: undefined;
      };
      update_service_delivery_status: {
        Args: {
          p_service_job_id: string;
          p_delivery_status: string;
        };
        Returns: undefined;
      };
      create_general_service_package: {
        Args: {
          p_name: string;
          p_included_items: string[];
          p_service_charge: number;
          /** Array of {inventory_item_id, default_quantity} objects — 0017_service_catalog_items.sql. */
          p_items?: Json;
        };
        Returns: string;
      };
      update_general_service_package: {
        Args: {
          p_id: string;
          p_name: string;
          p_included_items: string[];
          p_service_charge: number;
          p_items?: Json;
        };
        Returns: undefined;
      };
      create_specific_service: {
        Args: {
          p_name: string;
          p_default_charge?: number | null;
          p_items?: Json;
        };
        Returns: string;
      };
      create_combo: {
        Args: {
          p_name: string;
          p_description?: string | null;
          p_combo_price: number;
          p_valid_from?: string | null;
          p_valid_to?: string | null;
          p_components?: Json;
        };
        Returns: string;
      };
      update_combo: {
        Args: {
          p_id: string;
          p_name: string;
          p_description?: string | null;
          p_combo_price: number;
          p_valid_from?: string | null;
          p_valid_to?: string | null;
          p_components?: Json;
        };
        Returns: undefined;
      };
      duplicate_combo: {
        Args: {
          p_id: string;
          p_new_name: string;
        };
        Returns: string;
      };
      delete_combo: {
        Args: { p_id: string };
        Returns: undefined;
      };
      delete_general_service_package: {
        Args: { p_id: string };
        Returns: undefined;
      };
      delete_specific_service: {
        Args: { p_id: string };
        Returns: undefined;
      };
      update_sales_payment_status: {
        Args: {
          p_sale_id: string;
          p_payment_mode: PaymentMode | null;
          p_cash_amount: number;
          p_upi_amount: number;
        };
        Returns: undefined;
      };
      set_combo_active: {
        Args: {
          p_id: string;
          p_is_active: boolean;
        };
        Returns: undefined;
      };
      update_specific_service: {
        Args: {
          p_id: string;
          p_name: string;
          p_default_charge?: number | null;
          p_items?: Json;
        };
        Returns: undefined;
      };
      submit_online_order: {
        Args: {
          p_customer_name: string;
          p_mobile_number: string;
          p_address: string;
          p_pin_code: string;
          p_quantity_front: number;
          p_quantity_back: number;
          p_payment_screenshot_path: string;
        };
        Returns: string;
      };
      verify_online_order_payment: {
        Args: { p_order_id: string };
        Returns: undefined;
      };
      approve_online_order: {
        Args: { p_order_id: string };
        Returns: undefined;
      };
      dispatch_online_order: {
        Args: { p_order_id: string };
        Returns: undefined;
      };
      reject_online_order: {
        Args: { p_order_id: string; p_reason: string };
        Returns: undefined;
      };
      get_track_tyre_prices: {
        Args: Record<string, never>;
        Returns: { product_name: string; selling_price: number }[];
      };
      set_active_payment_qr: {
        Args: { p_id: string };
        Returns: Database["public"]["Tables"]["payment_qr_configs"]["Row"];
      };
    };
    Enums: {
      item_type: ItemType;
      stock_movement_reason: StockMovementReason;
      online_order_status: OnlineOrderStatus;
      user_role: UserRoleEnum;
      attendance_role: AttendanceRole;
      attendance_status: AttendanceStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
