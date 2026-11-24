export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      atc_codes: {
        Row: {
          applies_to: string
          archived: boolean
          code: string
          company_id: string
          created_at: string
          description: string
          id: string
          rate: number
        }
        Insert: {
          applies_to?: string
          archived?: boolean
          code: string
          company_id: string
          created_at?: string
          description: string
          id?: string
          rate?: number
        }
        Update: {
          applies_to?: string
          archived?: boolean
          code?: string
          company_id?: string
          created_at?: string
          description?: string
          id?: string
          rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "atc_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string
          company_id: string | null
          data: Json | null
          id: number
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          company_id?: string | null
          data?: Json | null
          id?: never
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          company_id?: string | null
          data?: Json | null
          id?: never
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          atp_date_issued: string | null
          atp_no: string | null
          atp_warning_threshold: number
          created_at: string
          created_by: string | null
          default_vat_rate: number
          fiscal_year_start_month: number
          id: string
          invoice_series_end: number | null
          invoice_series_next: number | null
          invoice_series_start: number | null
          last_sync_at: string | null
          name: string
          percentage_tax_rate: number
          price_mode: string
          printer_accreditation_date: string | null
          printer_accreditation_no: string | null
          printer_name: string | null
          printer_tin: string | null
          rdo_code: string | null
          registered_address: string | null
          tin: string | null
          trade_name: string | null
          vat_registered: boolean
          zip_code: string | null
        }
        Insert: {
          atp_date_issued?: string | null
          atp_no?: string | null
          atp_warning_threshold?: number
          created_at?: string
          created_by?: string | null
          default_vat_rate?: number
          fiscal_year_start_month?: number
          id?: string
          invoice_series_end?: number | null
          invoice_series_next?: number | null
          invoice_series_start?: number | null
          last_sync_at?: string | null
          name: string
          percentage_tax_rate?: number
          price_mode?: string
          printer_accreditation_date?: string | null
          printer_accreditation_no?: string | null
          printer_name?: string | null
          printer_tin?: string | null
          rdo_code?: string | null
          registered_address?: string | null
          tin?: string | null
          trade_name?: string | null
          vat_registered?: boolean
          zip_code?: string | null
        }
        Update: {
          atp_date_issued?: string | null
          atp_no?: string | null
          atp_warning_threshold?: number
          created_at?: string
          created_by?: string | null
          default_vat_rate?: number
          fiscal_year_start_month?: number
          id?: string
          invoice_series_end?: number | null
          invoice_series_next?: number | null
          invoice_series_start?: number | null
          last_sync_at?: string | null
          name?: string
          percentage_tax_rate?: number
          price_mode?: string
          printer_accreditation_date?: string | null
          printer_accreditation_no?: string | null
          printer_name?: string | null
          printer_tin?: string | null
          rdo_code?: string | null
          registered_address?: string | null
          tin?: string | null
          trade_name?: string | null
          vat_registered?: boolean
          zip_code?: string | null
        }
        Relationships: []
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          archived: boolean
          branch_code: string | null
          company_id: string
          contact_name: string | null
          created_at: string
          credit_limit: number | null
          default_atc: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          registered_address: string | null
          registered_name: string | null
          sc_pwd_id: string | null
          tax_type: Database["public"]["Enums"]["party_tax_type"]
          terms: string | null
          tin: string | null
          withholding_agent: boolean
        }
        Insert: {
          archived?: boolean
          branch_code?: string | null
          company_id: string
          contact_name?: string | null
          created_at?: string
          credit_limit?: number | null
          default_atc?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          registered_address?: string | null
          registered_name?: string | null
          sc_pwd_id?: string | null
          tax_type?: Database["public"]["Enums"]["party_tax_type"]
          terms?: string | null
          tin?: string | null
          withholding_agent?: boolean
        }
        Update: {
          archived?: boolean
          branch_code?: string | null
          company_id?: string
          contact_name?: string | null
          created_at?: string
          credit_limit?: number | null
          default_atc?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          registered_address?: string | null
          registered_name?: string | null
          sc_pwd_id?: string | null
          tax_type?: Database["public"]["Enums"]["party_tax_type"]
          terms?: string | null
          tin?: string | null
          withholding_agent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_sequences: {
        Row: {
          company_id: string
          next_no: number
          padding: number
          prefix: string
          txn_type: Database["public"]["Enums"]["txn_type"]
        }
        Insert: {
          company_id: string
          next_no?: number
          padding?: number
          prefix: string
          txn_type: Database["public"]["Enums"]["txn_type"]
        }
        Update: {
          company_id?: string
          next_no?: number
          padding?: number
          prefix?: string
          txn_type?: Database["public"]["Enums"]["txn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "doc_sequences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_levels: {
        Row: {
          company_id: string
          id: string
          item_id: string
          location_id: string
          lot_id: string | null
          qty: number
        }
        Insert: {
          company_id: string
          id?: string
          item_id: string
          location_id: string
          lot_id?: string | null
          qty?: number
        }
        Update: {
          company_id?: string
          id?: string
          item_id?: string
          location_id?: string
          lot_id?: string | null
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "item_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      item_lots: {
        Row: {
          company_id: string
          created_at: string
          expiry_date: string | null
          id: string
          item_id: string
          lot_no: string
          received_date: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          expiry_date?: string | null
          id?: string
          item_id: string
          lot_no: string
          received_date?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          expiry_date?: string | null
          id?: string
          item_id?: string
          lot_no?: string
          received_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_lots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_lots_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_serials: {
        Row: {
          company_id: string
          created_at: string
          id: string
          item_id: string
          location_id: string | null
          serial_no: string
          status: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          item_id: string
          location_id?: string | null
          serial_no: string
          status?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          item_id?: string
          location_id?: string | null
          serial_no?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_serials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_serials_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_serials_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          archived: boolean
          barcode: string | null
          category: string | null
          company_id: string
          cost: number
          created_at: string
          decimals_allowed: number
          description: string | null
          id: string
          name: string
          price: number
          reorder_point: number | null
          sku: string
          tax_code_id: string | null
          tracking: Database["public"]["Enums"]["tracking_type"]
          type: Database["public"]["Enums"]["item_type"]
          uom: string
        }
        Insert: {
          archived?: boolean
          barcode?: string | null
          category?: string | null
          company_id: string
          cost?: number
          created_at?: string
          decimals_allowed?: number
          description?: string | null
          id?: string
          name: string
          price?: number
          reorder_point?: number | null
          sku: string
          tax_code_id?: string | null
          tracking?: Database["public"]["Enums"]["tracking_type"]
          type?: Database["public"]["Enums"]["item_type"]
          uom?: string
        }
        Update: {
          archived?: boolean
          barcode?: string | null
          category?: string | null
          company_id?: string
          cost?: number
          created_at?: string
          decimals_allowed?: number
          description?: string | null
          id?: string
          name?: string
          price?: number
          reorder_point?: number | null
          sku?: string
          tax_code_id?: string | null
          tracking?: Database["public"]["Enums"]["tracking_type"]
          type?: Database["public"]["Enums"]["item_type"]
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          archived: boolean
          company_id: string
          created_at: string
          id: string
          is_default: boolean
          name: string
        }
        Insert: {
          address?: string | null
          archived?: boolean
          company_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
        }
        Update: {
          address?: string | null
          archived?: boolean
          company_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      tax_codes: {
        Row: {
          applies_to: string
          archived: boolean
          code: string
          company_id: string
          created_at: string
          id: string
          is_default: boolean
          kind: Database["public"]["Enums"]["tax_kind"]
          name: string
          rate: number
        }
        Insert: {
          applies_to?: string
          archived?: boolean
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          kind: Database["public"]["Enums"]["tax_kind"]
          name: string
          rate?: number
        }
        Update: {
          applies_to?: string
          archived?: boolean
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          kind?: Database["public"]["Enums"]["tax_kind"]
          name?: string
          rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_lines: {
        Row: {
          amount: number
          company_id: string
          description: string | null
          id: string
          item_id: string | null
          line_no: number
          lot_id: string | null
          qty: number
          qty_fulfilled: number
          qty_invoiced: number
          rate: number
          serial_id: string | null
          tax_code_id: string | null
          transaction_id: string
          vat_amount: number
        }
        Insert: {
          amount?: number
          company_id: string
          description?: string | null
          id?: string
          item_id?: string | null
          line_no?: number
          lot_id?: string | null
          qty?: number
          qty_fulfilled?: number
          qty_invoiced?: number
          rate?: number
          serial_id?: string | null
          tax_code_id?: string | null
          transaction_id: string
          vat_amount?: number
        }
        Update: {
          amount?: number
          company_id?: string
          description?: string | null
          id?: string
          item_id?: string | null
          line_no?: number
          lot_id?: string | null
          qty?: number
          qty_fulfilled?: number
          qty_invoiced?: number
          rate?: number
          serial_id?: string | null
          tax_code_id?: string | null
          transaction_id?: string
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "transaction_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_lines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "item_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_lines_serial_id_fkey"
            columns: ["serial_id"]
            isOneToOne: false
            referencedRelation: "item_serials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_lines_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_lines_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount_due: number
          archived: boolean
          bir_series_no: number | null
          company_id: string
          created_at: string
          created_by: string | null
          discount_amount: number
          discount_rate: number
          discount_type: Database["public"]["Enums"]["discount_kind"]
          due_date: string | null
          ewt_amount: number
          ewt_atc: string | null
          ewt_rate: number
          id: string
          location_id: string | null
          notes: string | null
          parent_txn_id: string | null
          party_id: string | null
          party_name: string | null
          party_type: string | null
          percentage_tax_amount: number
          price_mode: string
          qb_sync_status: string
          ref_no: string
          sc_pwd_id: string | null
          status: string
          to_location_id: string | null
          total: number
          txn_date: string
          type: Database["public"]["Enums"]["txn_type"]
          updated_at: string
          vat_amount: number
          vat_exempt_sales: number
          vatable_sales: number
          voided: boolean
          zero_rated_sales: number
        }
        Insert: {
          amount_due?: number
          archived?: boolean
          bir_series_no?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          discount_rate?: number
          discount_type?: Database["public"]["Enums"]["discount_kind"]
          due_date?: string | null
          ewt_amount?: number
          ewt_atc?: string | null
          ewt_rate?: number
          id?: string
          location_id?: string | null
          notes?: string | null
          parent_txn_id?: string | null
          party_id?: string | null
          party_name?: string | null
          party_type?: string | null
          percentage_tax_amount?: number
          price_mode?: string
          qb_sync_status?: string
          ref_no: string
          sc_pwd_id?: string | null
          status?: string
          to_location_id?: string | null
          total?: number
          txn_date?: string
          type: Database["public"]["Enums"]["txn_type"]
          updated_at?: string
          vat_amount?: number
          vat_exempt_sales?: number
          vatable_sales?: number
          voided?: boolean
          zero_rated_sales?: number
        }
        Update: {
          amount_due?: number
          archived?: boolean
          bir_series_no?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          discount_rate?: number
          discount_type?: Database["public"]["Enums"]["discount_kind"]
          due_date?: string | null
          ewt_amount?: number
          ewt_atc?: string | null
          ewt_rate?: number
          id?: string
          location_id?: string | null
          notes?: string | null
          parent_txn_id?: string | null
          party_id?: string | null
          party_name?: string | null
          party_type?: string | null
          percentage_tax_amount?: number
          price_mode?: string
          qb_sync_status?: string
          ref_no?: string
          sc_pwd_id?: string | null
          status?: string
          to_location_id?: string | null
          total?: number
          txn_date?: string
          type?: Database["public"]["Enums"]["txn_type"]
          updated_at?: string
          vat_amount?: number
          vat_exempt_sales?: number
          vatable_sales?: number
          voided?: boolean
          zero_rated_sales?: number
        }
        Relationships: [
          {
            foreignKeyName: "transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_parent_txn_id_fkey"
            columns: ["parent_txn_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          archived: boolean
          branch_code: string | null
          company_id: string
          contact_name: string | null
          created_at: string
          default_atc: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          registered_address: string | null
          registered_name: string | null
          tax_type: Database["public"]["Enums"]["party_tax_type"]
          terms: string | null
          tin: string | null
          withholding_agent: boolean
        }
        Insert: {
          archived?: boolean
          branch_code?: string | null
          company_id: string
          contact_name?: string | null
          created_at?: string
          default_atc?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          registered_address?: string | null
          registered_name?: string | null
          tax_type?: Database["public"]["Enums"]["party_tax_type"]
          terms?: string | null
          tin?: string | null
          withholding_agent?: boolean
        }
        Update: {
          archived?: boolean
          branch_code?: string | null
          company_id?: string
          contact_name?: string | null
          created_at?: string
          default_atc?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          registered_address?: string | null
          registered_name?: string | null
          tax_type?: Database["public"]["Enums"]["party_tax_type"]
          terms?: string | null
          tin?: string | null
          withholding_agent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "vendors_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage_tax: { Args: { _company: string }; Returns: boolean }
      can_write: { Args: { _company: string }; Returns: boolean }
      dashboard_stats: { Args: { _company: string }; Returns: Json }
      default_prefix: {
        Args: { _type: Database["public"]["Enums"]["txn_type"] }
        Returns: string
      }
      has_company_role: {
        Args: {
          _company: string
          _roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: boolean
      }
      is_company_member: { Args: { _company: string }; Returns: boolean }
      next_doc_number: {
        Args: {
          _company: string
          _type: Database["public"]["Enums"]["txn_type"]
        }
        Returns: string
      }
      save_transaction: { Args: { p: Json }; Returns: string }
      seed_company_defaults: { Args: { _company: string }; Returns: undefined }
      void_transaction: { Args: { _id: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "sales" | "warehouse" | "accounting" | "read_only"
      discount_kind: "none" | "regular" | "senior" | "pwd"
      item_type: "inventory" | "non_inventory" | "assembly" | "service"
      party_tax_type: "vatable" | "vat_exempt" | "zero_rated" | "government"
      tax_kind: "vat" | "exempt" | "zero_rated" | "percentage"
      tracking_type: "none" | "lot" | "serial"
      txn_type:
        | "estimate"
        | "sales_order"
        | "invoice"
        | "sales_receipt"
        | "purchase_order"
        | "receipt"
        | "bill"
        | "shipment"
        | "pick_ticket"
        | "return"
        | "rma"
        | "transfer"
        | "work_order"
        | "build"
        | "payment"
        | "adjustment"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "sales", "warehouse", "accounting", "read_only"],
      discount_kind: ["none", "regular", "senior", "pwd"],
      item_type: ["inventory", "non_inventory", "assembly", "service"],
      party_tax_type: ["vatable", "vat_exempt", "zero_rated", "government"],
      tax_kind: ["vat", "exempt", "zero_rated", "percentage"],
      tracking_type: ["none", "lot", "serial"],
      txn_type: [
        "estimate",
        "sales_order",
        "invoice",
        "sales_receipt",
        "purchase_order",
        "receipt",
        "bill",
        "shipment",
        "pick_ticket",
        "return",
        "rma",
        "transfer",
        "work_order",
        "build",
        "payment",
        "adjustment",
      ],
    },
  },
} as const
